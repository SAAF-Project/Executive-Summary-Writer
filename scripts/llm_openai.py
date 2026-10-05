"""OpenAI provider for the Executive Summary Writer (Chat Completions API).

The client and its settings come from scripts/openai_config.py, which you provide yourself (it is
git-ignored). It must define `client` (an `openai.OpenAI` or `openai.AzureOpenAI` instance) and
`DEPLOYMENT_NAME` (the model or deployment to call). `TEMPERATURE`, `TOPPVALUE` and
`RESPONSE_MAX_TOKENS` are used when present.
"""

import json
import logging
from typing import Any, Dict, List, Optional, Type

from pydantic import ValidationError

import prompts
from llm import EFFORT, BaseLLM, T

logger = logging.getLogger(__name__)

DEFAULT_MAX_OUTPUT_TOKENS = 16000
SAMPLING_PARAMS = ("temperature", "top_p")


def _material_text(material: Optional[List[Dict[str, Any]]]) -> str:
    """The audit material as plain text. Chat Completions takes text here, so PDF blocks are refused."""
    if not material:
        return ""
    if any(block.get("type") != "text" for block in material):
        raise RuntimeError(
            "PDF input is only supported with Claude. Convert the file to .docx, .md or .txt."
        )
    return "\n\n".join(block["text"] for block in material)


class OpenAILLM(BaseLLM):
    """OpenAI / Azure OpenAI provider."""

    def __init__(
        self,
        client: Any = None,
        deployment: Optional[str] = None,
        sampling: Optional[Dict[str, float]] = None,
        max_output_tokens: Optional[int] = None,
    ) -> None:
        if client is None:
            try:
                import openai_config as config
            except ImportError as exc:
                raise RuntimeError(
                    "The OpenAI option needs scripts/openai_config.py defining `client` and `DEPLOYMENT_NAME` "
                    f"(and the packages it imports). Import failed: {exc}"
                ) from exc
            client = config.client
            deployment = deployment or config.DEPLOYMENT_NAME
            if sampling is None:
                sampling = {}
                if hasattr(config, "TEMPERATURE"):
                    sampling["temperature"] = config.TEMPERATURE
                if hasattr(config, "TOPPVALUE"):
                    sampling["top_p"] = config.TOPPVALUE
            max_output_tokens = max_output_tokens or getattr(
                config, "RESPONSE_MAX_TOKENS", None
            )
        if not deployment:
            raise RuntimeError("No OpenAI model or deployment name given.")
        self.client = client
        self.deployment = deployment
        self.name = deployment
        self.sampling = dict(sampling or {})
        self.max_output_tokens = max_output_tokens or DEFAULT_MAX_OUTPUT_TOKENS

    # ---- request ----

    def _complete(
        self,
        task: str,
        material: Optional[List[Dict[str, Any]]],
        json_reply: bool,
    ) -> str:
        text = _material_text(material)
        user_content = f"{text}\n\n{task}" if text else task
        request: Dict[str, Any] = {
            "model": self.deployment,
            "messages": [
                {"role": "system", "content": prompts.SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            "max_completion_tokens": self.max_output_tokens,
            **self.sampling,
        }
        if json_reply:
            request["response_format"] = {"type": "json_object"}

        try:
            response = self.client.chat.completions.create(**request)
        except Exception as exc:
            # Some models accept only their default sampling settings. Drop
            # them once and continue without.
            rejected = [
                p
                for p in SAMPLING_PARAMS
                if p in self.sampling and p in str(exc)
            ]
            if getattr(exc, "status_code", None) != 400 or not rejected:
                raise
            logger.info(
                "The model does not accept %s; continuing without.",
                ", ".join(rejected),
            )
            for param in SAMPLING_PARAMS:
                self.sampling.pop(param, None)
                request.pop(param, None)
            response = self.client.chat.completions.create(**request)

        choice = response.choices[0]
        if choice.finish_reason == "length":
            raise RuntimeError(
                f"The reply was cut off at {self.max_output_tokens} output tokens. Increase RESPONSE_MAX_TOKENS "
                "in openai_config.py and run again."
            )
        if choice.finish_reason == "content_filter":
            raise RuntimeError(
                "The reply was blocked by the provider's content filter."
            )
        refusal = getattr(choice.message, "refusal", None)
        if refusal:
            raise RuntimeError(f"The model declined this request ({refusal}).")
        usage = getattr(response, "usage", None)
        if usage is not None:
            logger.debug(
                "tokens: input=%s output=%s",
                usage.prompt_tokens,
                usage.completion_tokens,
            )
        return (choice.message.content or "").strip()

    # ---- BaseLLM ----

    def _text(
        self,
        task: str,
        material: Optional[List[Dict[str, Any]]] = None,
        effort: str = EFFORT,
    ) -> str:
        return self._complete(task, material, json_reply=False)

    def _parsed(
        self,
        task: str,
        schema: Type[T],
        material: Optional[List[Dict[str, Any]]] = None,
        effort: str = EFFORT,
    ) -> T:
        task = (
            f"{task}\n\nReply with a single JSON object that matches this JSON schema, and nothing else:\n"
            f"{json.dumps(schema.model_json_schema())}"
        )
        reply = self._complete(task, material, json_reply=True)
        try:
            return schema.model_validate_json(reply)
        except ValidationError as exc:
            raise RuntimeError(
                f"The model's reply did not match the expected format: {exc}"
            ) from exc
