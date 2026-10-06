"""LangGraph workflow for the Executive Summary Writer.

The graph enforces the preparation phase: the node that writes the
summary can only be reached after root cause, relationships, storyline, positive aspects, overall
grade and tone have each been confirmed or explicitly skipped, and after the challenge review. Every question to the audit manager
is a LangGraph interrupt, so the run stops there until a reply is supplied.

    root cause -> relationships -> storyline -> positive aspects -> overall grade -> tone
        -> report header (domain, process risk) -> challenge review -> confirmation -> summary
        -> main findings table

The two questions for the report header have fixed answers and are read without the model.

The challenge review is optional: the audit manager is asked first whether they want one. Without it
the summary is written straight away; with it, at most three short questions are asked.

For the overall grade the order is the other way round: the model suggests a grade (A-D) from the
findings first, and the audit manager accepts it or chooses another. That reply is read without the
model, as it is one of four fixed values.

The last node needs no reply: it sums up each finding of the audit material with its recommendation.

Each of the first four steps is the same small loop:

    ask -> interpret --confirmed / skipped--> next step
            |   ^
         unknown |
            v   |
          propose -> ask (shows the proposals)
"""

import logging
from typing import Any, Dict, List, Optional, TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

import prompts
from prompts import StepSpec

logger = logging.getLogger(__name__)


class SummaryState(TypedDict, total=False):
    # input
    material: List[Dict[str, Any]]  # audit material as Claude content blocks
    request: str  # the audit manager's original request, e.g. "3 paragraphs / 600 words"
    # preparation phase
    root_cause: Optional[str]
    relationships: Optional[str]
    storyline: Optional[str]
    positives: Optional[str]
    grade_suggestion: str  # the grade the model suggested
    grade_reason: str
    grade: str  # the grade the audit manager chose: A, B, C or D
    tone: str
    domain: str  # report header: Finance, HR, Corporate, or the audit manager's own text
    domain_other: bool  # the audit manager chose "Other" and is asked to type the domain
    process_risk: str  # report header: Minor, Moderate, Material or Major
    done: List[str]  # steps that were confirmed or explicitly skipped
    proposals: Dict[str, str]  # step key -> options currently on the table
    challenge_wanted: bool  # the audit manager asked for a challenge review
    challenge_questions: List[str]
    challenge_answers: str
    # working values
    reply: str
    decision: str
    guidance: str
    ack: str
    # output
    confirmation: str
    summary: str
    pos_points: List[str]  # for the "Positive aspects" box of the report
    neg_points: Dict[str, str]  # main finding -> recommendation
    neg_titles: Dict[str, str]  # main finding -> title of its finding in the audit material


def confirmed_text(state: SummaryState) -> str:
    """What has been settled so far, one line per completed step."""
    lines = []
    for step in prompts.STEPS:
        if step.key in state.get("done", []):
            lines.append(
                f"- {step.label}: {state.get(step.key) or 'Skipped by the audit manager'}"
            )
    if state.get("grade"):
        grade = state["grade"]
        lines.append(f"- Overall grade: {grade} ({prompts.GRADES[grade]})")
    if state.get("tone"):
        lines.append(f"- Tone: {state['tone']}")
    return "\n".join(lines)


def _with_ack(state: SummaryState, message: str) -> str:
    ack = state.get("ack")
    return f"{ack}\n\n{message}" if ack else message


def _choice(reply: str, options: Any) -> Optional[str]:
    """The option a reply names, by its text or by its number (1, 2, ...). None if it names no option."""
    text = reply.strip(" .").lower()
    for number, option in enumerate(options, start=1):
        if text in (option.lower(), str(number)):
            return option
    return None


def build_graph(llm: Any, checkpointer: Any = None):
    """Compile the workflow. `llm` provides the Claude calls (see llm.ClaudeLLM)."""
    graph = StateGraph(SummaryState)

    # -------------------- Steps 1-4: ask first, propose second --------------------

    def add_step(step: StepSpec, next_node: str) -> None:
        ask_node, interpret_node, propose_node = (
            f"{step.key}_ask",
            f"{step.key}_interpret",
            f"{step.key}_propose",
        )

        def ask(state: SummaryState) -> dict:
            proposal = state.get("proposals", {}).get(step.key)
            if proposal:
                message = proposal
            elif step is prompts.STEPS[0]:
                message = f"{prompts.INTRO}\n\n{step.question}"
            else:
                message = step.question
            reply = interrupt(
                {"step": step.key, "message": _with_ack(state, message)}
            )
            return {"reply": str(reply).strip(), "ack": ""}

        def interpret(state: SummaryState) -> dict:
            proposal = state.get("proposals", {}).get(step.key)
            result = llm.interpret(step.question, state["reply"], proposal)
            done = state.get("done", []) + [step.key]

            if result.decision == "confirmed" and result.text.strip():
                text = result.text.strip()
                if step.refine and not proposal:
                    logger.info("Refining the storyline ...")
                    text = llm.refine_storyline(
                        text, state["material"], confirmed_text(state)
                    )
                return {
                    step.key: text,
                    "done": done,
                    "decision": "confirmed",
                    "ack": f"{step.label} noted: {text}",
                }

            if result.decision == "skipped":
                return {
                    step.key: None,
                    "done": done,
                    "decision": "skipped",
                    "ack": f"{step.label}: skipped.",
                }

            return {"decision": "unknown", "guidance": result.text.strip()}

        def propose(state: SummaryState) -> dict:
            logger.info(
                "Analysing the audit material to propose options (%s) ...",
                step.label.lower(),
            )
            proposals = dict(state.get("proposals", {}))
            options = llm.propose(
                step,
                state["material"],
                confirmed_text(state),
                state.get("guidance", ""),
                proposals.get(step.key),
            )
            proposals[step.key] = f"{options}\n\n{step.closing}"
            return {"proposals": proposals}

        graph.add_node(ask_node, ask)
        graph.add_node(interpret_node, interpret)
        graph.add_node(propose_node, propose)
        graph.add_edge(ask_node, interpret_node)
        graph.add_conditional_edges(
            interpret_node,
            lambda state: (
                "propose" if state["decision"] == "unknown" else "next"
            ),
            {"propose": propose_node, "next": next_node},
        )
        graph.add_edge(propose_node, ask_node)

    add_step(prompts.ROOT_CAUSE, "relationships_ask")
    add_step(prompts.RELATIONSHIPS, "storyline_ask")
    add_step(prompts.STORYLINE, "positives_ask")
    add_step(prompts.POSITIVES, "grade_suggest")
    graph.add_edge(START, "root_cause_ask")

    # -------------------- Step 5: overall grade (propose first, then ask) --------------------

    def grade_suggest(state: SummaryState) -> dict:
        logger.info("Reading the findings to suggest an overall grade ...")
        suggestion = llm.suggest_grade(state["material"])
        return {
            "grade_suggestion": suggestion.grade,
            "grade_reason": suggestion.reason.strip(),
        }

    def grade_ask(state: SummaryState) -> dict:
        grade = state["grade_suggestion"]
        message = prompts.GRADE_QUESTION.format(
            grade=grade,
            definition=prompts.GRADES[grade],
            reason=state["grade_reason"],
        )
        reply = interrupt(
            {
                "step": "grade",
                "message": _with_ack(state, message),
                "options": list(prompts.GRADES),
            }
        )
        return {"reply": str(reply).strip(), "ack": ""}

    def grade_interpret(state: SummaryState) -> dict:
        choice = state["reply"].upper().removeprefix("GRADE").strip(" .")
        if choice in prompts.GRADE_ACCEPT:
            choice = state["grade_suggestion"]
        if choice not in prompts.GRADES:
            return {"decision": "unknown", "ack": prompts.GRADE_RETRY}
        return {
            "grade": choice,
            "decision": "confirmed",
            "ack": f"Overall grade noted: {choice}",
        }

    # -------------------- Step 6: tone --------------------

    def tone_ask(state: SummaryState) -> dict:
        reply = interrupt(
            {
                "step": "tone",
                "message": _with_ack(state, prompts.TONE_QUESTION),
                "options": list(prompts.TONES),
            }
        )
        return {"reply": str(reply).strip(), "ack": ""}

    def tone_interpret(state: SummaryState) -> dict:
        reply = state["reply"]
        # one of the four tones, by its name or its number, is read without the model
        tone = (
            _choice(reply, prompts.TONES) or llm.interpret_tone(reply)
            if reply
            else prompts.DEFAULT_TONE
        )
        return {"tone": tone, "ack": f"Tone noted: {tone}"}

    # -------------------- Report header: domain and process risk (fixed answers) --------------------

    def domain_ask(state: SummaryState) -> dict:
        if state.get("domain_other"):
            question = {"step": "domain", "message": prompts.DOMAIN_OTHER}
        else:
            question = {
                "step": "domain",
                "message": _with_ack(state, prompts.DOMAIN_QUESTION),
                "options": list(prompts.DOMAINS),
            }
        return {"reply": str(interrupt(question)).strip(), "ack": ""}

    def domain_interpret(state: SummaryState) -> dict:
        reply = state["reply"]
        choice = None if state.get("domain_other") else _choice(reply, prompts.DOMAINS)
        if choice == prompts.DOMAINS[-1] or not reply:
            # "Other", or no reply: the audit manager types the domain
            return {"domain_other": True, "decision": "unknown"}
        domain = choice or reply
        return {
            "domain": domain,
            "domain_other": False,
            "decision": "confirmed",
            "ack": f"Domain noted: {domain}",
        }

    def process_risk_ask(state: SummaryState) -> dict:
        reply = interrupt(
            {
                "step": "process_risk",
                "message": _with_ack(state, prompts.PROCESS_RISK_QUESTION),
                "options": list(prompts.PROCESS_RISKS),
            }
        )
        return {"reply": str(reply).strip(), "ack": ""}

    def process_risk_interpret(state: SummaryState) -> dict:
        choice = _choice(state["reply"], prompts.PROCESS_RISKS)
        if choice is None:
            return {"decision": "unknown", "ack": prompts.PROCESS_RISK_RETRY}
        return {
            "process_risk": choice,
            "decision": "confirmed",
            "ack": f"Process risk noted: {choice}",
        }

    # -------------------- Challenge review (only when the audit manager wants one) --------------------

    def challenge_offer(state: SummaryState) -> dict:
        reply = interrupt(
            {
                "step": "challenge",
                "message": _with_ack(state, prompts.CHALLENGE_OFFER),
                "options": list(prompts.CHALLENGE_OPTIONS),
            }
        )
        return {"reply": str(reply).strip(), "ack": ""}

    def challenge_offer_interpret(state: SummaryState) -> dict:
        choice = state["reply"].upper().strip(" .!")
        if choice in prompts.CHALLENGE_YES:
            return {"challenge_wanted": True, "decision": "yes"}
        if choice in prompts.CHALLENGE_NO:
            return {"challenge_wanted": False, "decision": "no"}
        return {"decision": "unknown", "ack": prompts.CHALLENGE_RETRY}

    def challenge_review(state: SummaryState) -> dict:
        logger.info(
            "Reviewing the information from the Board, regulator, external auditor and CRO perspectives ..."
        )
        questions = [
            q.strip()
            for q in llm.challenge(state["material"], confirmed_text(state))
            if q.strip()
        ]
        return {
            "challenge_questions": questions[: prompts.MAX_CHALLENGE_QUESTIONS]
        }

    def challenge_ask(state: SummaryState) -> dict:
        questions = "\n".join(
            f"{i}. {q}"
            for i, q in enumerate(state["challenge_questions"], start=1)
        )
        message = prompts.CHALLENGE_QUESTIONS.format(questions=questions)
        reply = interrupt(
            {"step": "challenge", "message": _with_ack(state, message)}
        )
        return {"challenge_answers": str(reply).strip(), "ack": ""}

    # -------------------- Pre-summary confirmation and summary --------------------

    def confirm(state: SummaryState) -> dict:
        return {"confirmation": confirmed_text(state)}

    def write_summary(state: SummaryState) -> dict:
        missing = [
            s.key for s in prompts.STEPS if s.key not in state.get("done", [])
        ]
        missing += [key for key in ("grade", "tone") if not state.get(key)]
        if missing:
            raise RuntimeError(
                f"Preparation phase incomplete, no summary written (open: {missing})."
            )
        logger.info("Writing the Executive Board summary ...")
        result = llm.write_summary(
            state["material"],
            state["confirmation"],
            state["tone"],
            state.get("request", ""),
            state.get("challenge_questions", []),
            state.get("challenge_answers", ""),
        )
        return {"summary": result.exe_summary, "pos_points": result.pos_points}

    def summarise_findings(state: SummaryState) -> dict:
        logger.info("Summarising the findings and recommendations ...")
        findings = llm.summarise_findings(state["material"])
        return {
            "neg_points": {f.finding: f.recommendation for f in findings},
            "neg_titles": {f.finding: f.title for f in findings},
        }

    graph.add_node("grade_suggest", grade_suggest)
    graph.add_node("grade_ask", grade_ask)
    graph.add_node("grade_interpret", grade_interpret)
    graph.add_node("tone_ask", tone_ask)
    graph.add_node("tone_interpret", tone_interpret)
    graph.add_node("domain_ask", domain_ask)
    graph.add_node("domain_interpret", domain_interpret)
    graph.add_node("process_risk_ask", process_risk_ask)
    graph.add_node("process_risk_interpret", process_risk_interpret)
    graph.add_node("challenge_offer", challenge_offer)
    graph.add_node("challenge_offer_interpret", challenge_offer_interpret)
    graph.add_node("challenge_review", challenge_review)
    graph.add_node("challenge_ask", challenge_ask)
    graph.add_node("confirm", confirm)
    graph.add_node("write_summary", write_summary)
    graph.add_node("summarise_findings", summarise_findings)

    graph.add_edge("grade_suggest", "grade_ask")
    graph.add_edge("grade_ask", "grade_interpret")
    graph.add_conditional_edges(
        "grade_interpret",
        lambda state: "next" if state["decision"] == "confirmed" else "ask",
        {"ask": "grade_ask", "next": "tone_ask"},
    )
    graph.add_edge("tone_ask", "tone_interpret")
    graph.add_edge("tone_interpret", "domain_ask")
    graph.add_edge("domain_ask", "domain_interpret")
    graph.add_conditional_edges(
        "domain_interpret",
        lambda state: "next" if state["decision"] == "confirmed" else "ask",
        {"ask": "domain_ask", "next": "process_risk_ask"},
    )
    graph.add_edge("process_risk_ask", "process_risk_interpret")
    graph.add_conditional_edges(
        "process_risk_interpret",
        lambda state: "next" if state["decision"] == "confirmed" else "ask",
        {"ask": "process_risk_ask", "next": "challenge_offer"},
    )
    graph.add_edge("challenge_offer", "challenge_offer_interpret")
    graph.add_conditional_edges(
        "challenge_offer_interpret",
        lambda state: state["decision"],
        {
            "yes": "challenge_review",
            "no": "confirm",
            "unknown": "challenge_offer",
        },
    )
    graph.add_conditional_edges(
        "challenge_review",
        lambda state: "ask" if state["challenge_questions"] else "confirm",
        {"ask": "challenge_ask", "confirm": "confirm"},
    )
    graph.add_edge("challenge_ask", "confirm")
    graph.add_edge("confirm", "write_summary")
    graph.add_edge("write_summary", "summarise_findings")
    graph.add_edge("summarise_findings", END)

    return graph.compile(checkpointer=checkpointer or InMemorySaver())
