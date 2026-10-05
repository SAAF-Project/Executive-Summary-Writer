"""LangGraph workflow for the Executive Summary Writer.

The graph enforces the preparation phase: the node that writes the
summary can only be reached after root cause, relationships, storyline and tone have each been
confirmed or explicitly skipped, and after the challenge review. Every question to the audit manager
is a LangGraph interrupt, so the run stops there until a reply is supplied.

    root cause -> relationships -> storyline -> tone -> challenge review -> confirmation -> summary

Each of the first three steps is the same small loop:

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
    material: List[Dict[str, Any]]   # audit material as Claude content blocks
    request: str                     # the audit manager's original request, e.g. "3 paragraphs / 600 words"
    # preparation phase
    root_cause: Optional[str]
    relationships: Optional[str]
    storyline: Optional[str]
    tone: str
    done: List[str]                  # steps that were confirmed or explicitly skipped
    proposals: Dict[str, str]        # step key -> options currently on the table
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


def confirmed_text(state: SummaryState) -> str:
    """What has been settled so far, one line per completed step."""
    lines = []
    for step in prompts.STEPS:
        if step.key in state.get("done", []):
            lines.append(f"- {step.label}: {state.get(step.key) or 'Skipped by the audit manager'}")
    if state.get("tone"):
        lines.append(f"- Tone: {state['tone']}")
    return "\n".join(lines)


def _with_ack(state: SummaryState, message: str) -> str:
    ack = state.get("ack")
    return f"{ack}\n\n{message}" if ack else message


def build_graph(llm: Any, checkpointer: Any = None):
    """Compile the workflow. `llm` provides the Claude calls (see llm.ClaudeLLM)."""
    graph = StateGraph(SummaryState)

    # -------------------- Steps 1-3: ask first, propose second --------------------

    def add_step(step: StepSpec, next_node: str) -> None:
        ask_node, interpret_node, propose_node = f"{step.key}_ask", f"{step.key}_interpret", f"{step.key}_propose"

        def ask(state: SummaryState) -> dict:
            proposal = state.get("proposals", {}).get(step.key)
            if proposal:
                message = proposal
            elif step is prompts.STEPS[0]:
                message = f"{prompts.INTRO}\n\n{step.question}"
            else:
                message = step.question
            reply = interrupt({"step": step.key, "message": _with_ack(state, message)})
            return {"reply": str(reply).strip(), "ack": ""}

        def interpret(state: SummaryState) -> dict:
            proposal = state.get("proposals", {}).get(step.key)
            result = llm.interpret(step.question, state["reply"], proposal)
            done = state.get("done", []) + [step.key]

            if result.decision == "confirmed" and result.text.strip():
                text = result.text.strip()
                if step.refine and not proposal:
                    logger.info("Refining the storyline ...")
                    text = llm.refine_storyline(text, state["material"], confirmed_text(state))
                return {step.key: text, "done": done, "decision": "confirmed", "ack": f"{step.label} noted: {text}"}

            if result.decision == "skipped":
                return {step.key: None, "done": done, "decision": "skipped", "ack": f"{step.label}: skipped."}

            return {"decision": "unknown", "guidance": result.text.strip()}

        def propose(state: SummaryState) -> dict:
            logger.info("Analysing the audit material to propose options (%s) ...", step.label.lower())
            proposals = dict(state.get("proposals", {}))
            options = llm.propose(
                step, state["material"], confirmed_text(state), state.get("guidance", ""), proposals.get(step.key)
            )
            proposals[step.key] = f"{options}\n\n{step.closing}"
            return {"proposals": proposals}

        graph.add_node(ask_node, ask)
        graph.add_node(interpret_node, interpret)
        graph.add_node(propose_node, propose)
        graph.add_edge(ask_node, interpret_node)
        graph.add_conditional_edges(
            interpret_node,
            lambda state: "propose" if state["decision"] == "unknown" else "next",
            {"propose": propose_node, "next": next_node},
        )
        graph.add_edge(propose_node, ask_node)

    add_step(prompts.ROOT_CAUSE, "relationships_ask")
    add_step(prompts.RELATIONSHIPS, "storyline_ask")
    add_step(prompts.STORYLINE, "tone_ask")
    graph.add_edge(START, "root_cause_ask")

    # -------------------- Step 4: tone --------------------

    def tone_ask(state: SummaryState) -> dict:
        reply = interrupt({"step": "tone", "message": _with_ack(state, prompts.TONE_QUESTION)})
        return {"reply": str(reply).strip(), "ack": ""}

    def tone_interpret(state: SummaryState) -> dict:
        reply = state["reply"]
        tone = llm.interpret_tone(reply) if reply else prompts.DEFAULT_TONE
        return {"tone": tone, "ack": f"Tone noted: {tone}"}

    # -------------------- Step 5: challenge review --------------------

    def challenge_review(state: SummaryState) -> dict:
        logger.info("Reviewing the information from the Board, regulator, external auditor and CRO perspectives ...")
        questions = [q.strip() for q in llm.challenge(state["material"], confirmed_text(state)) if q.strip()]
        return {"challenge_questions": questions}

    def challenge_ask(state: SummaryState) -> dict:
        questions = "\n".join(f"{i}. {q}" for i, q in enumerate(state["challenge_questions"], start=1))
        message = (
            "Step 5: Challenge review. Before I write the summary, the following information would be "
            f"important for a board-level summary:\n\n{questions}\n\n"
            "Please answer what you can, or reply 'proceed' to continue with the information available."
        )
        reply = interrupt({"step": "challenge", "message": _with_ack(state, message)})
        return {"challenge_answers": str(reply).strip(), "ack": ""}

    # -------------------- Pre-summary confirmation and summary --------------------

    def confirm(state: SummaryState) -> dict:
        return {"confirmation": confirmed_text(state)}

    def write_summary(state: SummaryState) -> dict:
        missing = [s.key for s in prompts.STEPS if s.key not in state.get("done", [])]
        if missing or not state.get("tone"):
            raise RuntimeError(f"Preparation phase incomplete, no summary written (open: {missing or ['tone']}).")
        logger.info("Writing the Executive Board summary ...")
        summary = llm.write_summary(
            state["material"], state["confirmation"], state["tone"], state.get("request", ""),
            state.get("challenge_questions", []), state.get("challenge_answers", ""),
        )
        return {"summary": summary}

    graph.add_node("tone_ask", tone_ask)
    graph.add_node("tone_interpret", tone_interpret)
    graph.add_node("challenge_review", challenge_review)
    graph.add_node("challenge_ask", challenge_ask)
    graph.add_node("confirm", confirm)
    graph.add_node("write_summary", write_summary)

    graph.add_edge("tone_ask", "tone_interpret")
    graph.add_edge("tone_interpret", "challenge_review")
    graph.add_conditional_edges(
        "challenge_review",
        lambda state: "ask" if state["challenge_questions"] else "confirm",
        {"ask": "challenge_ask", "confirm": "confirm"},
    )
    graph.add_edge("challenge_ask", "confirm")
    graph.add_edge("confirm", "write_summary")
    graph.add_edge("write_summary", END)

    return graph.compile(checkpointer=checkpointer or InMemorySaver())
