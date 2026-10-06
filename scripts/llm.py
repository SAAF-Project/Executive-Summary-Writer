"""Model calls for the Executive Summary Writer: the shared step logic and the Claude API provider.

All settings are read from environment variables. The API key is taken from ANTHROPIC_API_KEY by the
SDK automatically; no credentials are hard-coded.
"""

import logging
import os
from typing import Any, Dict, List, Literal, Optional, Type, TypeVar

import anthropic
from pydantic import BaseModel

import prompts
from prompts import StepSpec

logger = logging.getLogger(__name__)

# -------------------- Model config --------------------
MODEL_NAME = os.getenv("ANTHROPIC_MODEL", "claude-opus-5-5")
EFFORT = os.getenv("MODEL_EFFORT", "high")  # low | medium | high | xhigh | max
MAX_OUTPUT_TOKENS = int(os.getenv("MAX_OUTPUT_TOKENS", "16000"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "4"))
REQUEST_TIMEOUT_SEC = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "600"))
# If a safety classifier declines a request, let the API re-run it on
# Anthropic's recommended fallback model.
USE_FALLBACKS = os.getenv("USE_REFUSAL_FALLBACKS", "1") != "0"

T = TypeVar("T", bound=BaseModel)


# -------------------- Structured replies --------------------


class Interpretation(BaseModel):
    decision: Literal["confirmed", "unknown", "skipped"]
    text: str


class ToneChoice(BaseModel):
    tone: Literal["Positive", "Balanced", "Neutral-professional", "Critical"]


class GradeSuggestion(BaseModel):
    grade: Literal["A", "B", "C", "D"]
    reason: str


class ChallengeReview(BaseModel):
    questions: List[str]


class Finding(BaseModel):
    finding: str
    recommendation: str


class FindingsSummary(BaseModel):
    neg_points: List[Finding]


class BoardSummary(BaseModel):
    """The summary with the points for the "Positive aspects" box of the report."""

    exe_summary: str
    pos_points: List[str]


# -------------------- Steps (shared by every provider) --------------------


class BaseLLM:
    """The model calls behind each step of the graph. A provider implements _text and _parsed."""

    name = "model"

    def _text(
        self,
        task: str,
        material: Optional[List[Dict[str, Any]]] = None,
        effort: str = EFFORT,
    ) -> str:
        raise NotImplementedError

    def _parsed(
        self,
        task: str,
        schema: Type[T],
        material: Optional[List[Dict[str, Any]]] = None,
        effort: str = EFFORT,
    ) -> T:
        raise NotImplementedError

    def interpret(
        self, question: str, reply: str, proposal: Optional[str]
    ) -> Interpretation:
        """Decide whether the audit manager answered, does not know, or wants to skip."""
        proposal_block = (
            f"Options that were proposed:\n{proposal}\n\n" if proposal else ""
        )
        task = prompts.INTERPRET_REPLY.format(
            question=question, proposal_block=proposal_block, reply=reply
        )
        return self._parsed(task, Interpretation, effort="low")

    def interpret_tone(self, reply: str) -> str:
        return self._parsed(
            prompts.INTERPRET_TONE.format(reply=reply),
            ToneChoice,
            effort="low",
        ).tone

    def propose(
        self,
        step: StepSpec,
        material: List[Dict[str, Any]],
        confirmed: str,
        guidance: str,
        previous: Optional[str],
    ) -> str:
        """Propose options for a step the audit manager could not answer."""
        task = step.propose
        if confirmed:
            task += f"\n\nConfirmed so far:\n{confirmed}"
        if previous:
            task += f"\n\nYou proposed the following before and the audit manager wants different options:\n{previous}"
        if guidance:
            task += f"\n\nDirection from the audit manager:\n{guidance}"
        return self._text(task, material)

    def refine_storyline(
        self, storyline: str, material: List[Dict[str, Any]], confirmed: str
    ) -> str:
        task = prompts.REFINE_STORYLINE.format(storyline=storyline)
        if confirmed:
            task += f"\n\nConfirmed so far:\n{confirmed}"
        return self._text(task, material)

    def suggest_grade(self, material: List[Dict[str, Any]]) -> GradeSuggestion:
        """The overall grade (A-D) that the findings of the audit material point to, with the reason."""
        return self._parsed(prompts.SUGGEST_GRADE, GradeSuggestion, material)

    def challenge(
        self, material: List[Dict[str, Any]], confirmed: str
    ) -> List[str]:
        task = f"{prompts.CHALLENGE_REVIEW}\n\nConfirmed so far:\n{confirmed}"
        return self._parsed(task, ChallengeReview, material).questions

    def write_summary(
        self,
        material: List[Dict[str, Any]],
        confirmed: str,
        tone: str,
        request: str,
        challenge_questions: List[str],
        challenge_answers: str,
    ) -> BoardSummary:
        request_block = (
            "The audit manager's original request (follow its format preferences, such as length, where "
            f"they do not conflict with the structure below):\n{request}\n\n"
            if request
            else ""
        )
        tone_block = (
            f"{prompts.BALANCED_DEFINITION}\n\n"
            if tone == prompts.DEFAULT_TONE
            else ""
        )
        challenge_block = ""
        if challenge_questions:
            questions = "\n".join(f"- {q}" for q in challenge_questions)
            challenge_block = (
                f"Additional questions asked in the challenge review:\n{questions}\n\n"
                f"Audit manager's answer:\n{challenge_answers or '(no answer)'}\n\n"
                "Treat any question that was not answered as a remaining gap.\n\n"
            )
        task = prompts.WRITE_SUMMARY.format(
            request_block=request_block,
            confirmed=confirmed,
            tone_block=tone_block,
            challenge_block=challenge_block,
        )
        return self._parsed(
            f"{task}\n\n{prompts.SUMMARY_FIELDS}", BoardSummary, material
        )

    def summarise_findings(self, material: List[Dict[str, Any]]) -> List[Finding]:
        """Each main finding with its recommendation, in one sentence each, for the "Main findings" table."""
        return self._parsed(
            prompts.SUMMARISE_FINDINGS, FindingsSummary, material
        ).neg_points


# -------------------- Claude --------------------


class ClaudeLLM(BaseLLM):
    """Claude API provider."""

    name = MODEL_NAME

    def __init__(self, client: Optional[anthropic.Anthropic] = None) -> None:
        # The SDK retries connection errors, 408, 409, 429 and 5xx with
        # exponential backoff.
        self.client = client or anthropic.Anthropic(
            timeout=REQUEST_TIMEOUT_SEC, max_retries=MAX_RETRIES
        )

    # ---- request building ----

    def _request(
        self, task: str, material: Optional[List[Dict[str, Any]]], effort: str
    ) -> Dict[str, Any]:
        """Build the request. The audit material comes first and carries the cache breakpoint, so every
        step after the first reads the system prompt and the material from the prompt cache.
        """
        content: List[Dict[str, Any]] = []
        if material:
            content.extend(material[:-1])
            content.append(
                {**material[-1], "cache_control": {"type": "ephemeral"}}
            )
        content.append({"type": "text", "text": task})

        request: Dict[str, Any] = {
            "model": MODEL_NAME,
            "max_tokens": MAX_OUTPUT_TOKENS,
            "system": prompts.SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": content}],
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": effort},
        }
        if USE_FALLBACKS:
            request["extra_headers"] = {
                "anthropic-beta": "server-side-fallback-2026-07-01"
            }
            request["extra_body"] = {"fallbacks": "default"}
        return request

    @staticmethod
    def _check(response: Any) -> None:
        if response.stop_reason == "refusal":
            details = getattr(response, "stop_details", None)
            explanation = (
                getattr(details, "explanation", None) or "no explanation given"
            )
            raise RuntimeError(
                f"The model declined this request ({explanation})."
            )
        if response.stop_reason == "max_tokens":
            raise RuntimeError(
                f"The reply was cut off at MAX_OUTPUT_TOKENS={MAX_OUTPUT_TOKENS}. Increase it and run again."
            )
        usage = response.usage
        logger.debug(
            "tokens: input=%s cache_read=%s cache_write=%s output=%s",
            usage.input_tokens,
            usage.cache_read_input_tokens,
            usage.cache_creation_input_tokens,
            usage.output_tokens,
        )

    def _text(
        self,
        task: str,
        material: Optional[List[Dict[str, Any]]] = None,
        effort: str = EFFORT,
    ) -> str:
        with self.client.messages.stream(
            **self._request(task, material, effort)
        ) as stream:
            response = stream.get_final_message()
        self._check(response)
        return "".join(
            block.text for block in response.content if block.type == "text"
        ).strip()

    def _parsed(
        self,
        task: str,
        schema: Type[T],
        material: Optional[List[Dict[str, Any]]] = None,
        effort: str = EFFORT,
    ) -> T:
        response = self.client.messages.parse(
            **self._request(task, material, effort), output_format=schema
        )
        self._check(response)
        return response.parsed_output
