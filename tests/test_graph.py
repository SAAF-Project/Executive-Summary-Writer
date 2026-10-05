"""Tests for the conversation flow. Claude is replaced by a scripted stand-in, so no API calls are made.

    pytest tests/
"""
import sys
from pathlib import Path

import pytest
from langgraph.types import Command

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import prompts  # noqa: E402
from graph import build_graph  # noqa: E402
from llm import Interpretation  # noqa: E402

MATERIAL = [{"type": "text", "text": "Synthetic audit material."}]

UNKNOWN_REPLIES = {"no", "i don't know", "none of these, try again"}
SKIP_REPLIES = {"skip"}


class FakeLLM:
    """Records every call so the tests can check what happened and in which order."""

    def __init__(self, challenge_questions=None):
        self.calls = []
        self.challenge_questions = challenge_questions or []

    def interpret(self, question, reply, proposal):
        self.calls.append("interpret")
        if reply.lower() in UNKNOWN_REPLIES:
            return Interpretation(decision="unknown", text="")
        if reply.lower() in SKIP_REPLIES:
            return Interpretation(decision="skipped", text="")
        return Interpretation(decision="confirmed", text=reply)

    def interpret_tone(self, reply):
        self.calls.append("interpret_tone")
        return "Critical" if "critical" in reply.lower() or reply == "4" else "Balanced"

    def propose(self, step, material, confirmed, guidance, previous):
        self.calls.append(f"propose:{step.key}")
        return f"OPTIONS for {step.key}" + (" (second round)" if previous else "")

    def refine_storyline(self, storyline, material, confirmed):
        self.calls.append("refine_storyline")
        return f"Refined: {storyline}"

    def challenge(self, material, confirmed):
        self.calls.append("challenge")
        return self.challenge_questions

    def write_summary(self, material, confirmed, tone, request, challenge_questions, challenge_answers):
        self.calls.append("write_summary")
        self.summary_args = {
            "confirmed": confirmed, "tone": tone, "request": request,
            "challenge_questions": challenge_questions, "challenge_answers": challenge_answers,
        }
        return "### Executive Board Summary\n\nSynthetic summary."


def run(llm, replies, request=""):
    """Drive the graph with the given replies. Returns (messages shown to the user, final state)."""
    app = build_graph(llm)
    config = {"configurable": {"thread_id": "test"}}
    messages = []
    result = app.invoke({"material": MATERIAL, "request": request}, config)
    for reply in replies:
        assert "__interrupt__" in result, f"graph finished before reply {reply!r} was used"
        messages.append(result["__interrupt__"][0].value["message"])
        result = app.invoke(Command(resume=reply), config)
    return messages, result


def test_first_response_only_asks_step_1():
    llm = FakeLLM()
    app = build_graph(llm)
    result = app.invoke({"material": MATERIAL}, {"configurable": {"thread_id": "t"}})

    message = result["__interrupt__"][0].value["message"]
    assert message == f"{prompts.INTRO}\n\n{prompts.ROOT_CAUSE.question}"
    assert llm.calls == []  # no analysis and no summary before the first question
    assert "summary" not in result


def test_user_knows_everything_goes_straight_through():
    llm = FakeLLM()
    messages, result = run(llm, ["Unclear ownership", "F1 causes F2", "Ownership story", "2"])

    assert not any(call.startswith("propose") for call in llm.calls)
    assert result["root_cause"] == "Unclear ownership"
    assert result["relationships"] == "F1 causes F2"
    assert result["storyline"] == "Refined: Ownership story"  # a supplied storyline is strengthened
    assert result["tone"] == "Balanced"
    assert result["summary"].startswith("### Executive Board Summary")
    assert llm.calls[-1] == "write_summary"
    # each next question briefly confirms the previous answer
    assert messages[1].startswith("Root cause noted: Unclear ownership")
    assert prompts.RELATIONSHIPS.question in messages[1]


def test_summary_is_never_written_before_all_steps_are_done():
    llm = FakeLLM()
    app = build_graph(llm)
    config = {"configurable": {"thread_id": "gate"}}
    result = app.invoke({"material": MATERIAL, "request": "Write an executive summary in 600 words"}, config)

    for reply in ["Please provide a summary", "Summarise in 600 words", "Write the summary now"]:
        assert "write_summary" not in llm.calls
        assert "summary" not in result
        result = app.invoke(Command(resume=reply), config)

    # three replies only got us through steps 1-3; the graph is waiting at the tone question
    assert "write_summary" not in llm.calls
    assert prompts.TONE_QUESTION in result["__interrupt__"][0].value["message"]


def test_unknown_root_cause_gets_proposals_and_stops_for_a_choice():
    llm = FakeLLM()
    messages, result = run(llm, ["No", "Option 2", "skip", "skip", ""])

    assert llm.calls[:3] == ["interpret", "propose:root_cause", "interpret"]
    assert messages[1] == f"OPTIONS for root_cause\n\n{prompts.ROOT_CAUSE.closing}"
    assert result["root_cause"] == "Option 2"
    assert prompts.RELATIONSHIPS.question in messages[2]  # step 2 only starts after the choice


def test_rejected_proposals_are_proposed_again():
    llm = FakeLLM()
    messages, _ = run(llm, ["No", "None of these, try again", "Option 1", "skip", "skip", ""])

    assert llm.calls.count("propose:root_cause") == 2
    assert "(second round)" in messages[2]


def test_skipped_steps_and_default_tone():
    llm = FakeLLM()
    _, result = run(llm, ["skip", "skip", "skip", ""])

    assert result["root_cause"] is None and result["relationships"] is None and result["storyline"] is None
    assert result["tone"] == prompts.DEFAULT_TONE
    assert "interpret_tone" not in llm.calls  # an empty reply takes the default without a model call
    assert "- Root cause: Skipped by the audit manager" in result["confirmation"]
    assert "write_summary" in llm.calls


def test_storyline_chosen_from_proposals_is_not_refined():
    llm = FakeLLM()
    _, result = run(llm, ["skip", "skip", "No", "Option B", "4"])

    assert "refine_storyline" not in llm.calls
    assert result["storyline"] == "Option B"
    assert result["tone"] == "Critical"


def test_challenge_questions_are_asked_before_the_summary():
    llm = FakeLLM(challenge_questions=["What is the financial exposure?", "Who owns remediation?"])
    messages, result = run(llm, ["Ownership", "skip", "skip", "2", "Exposure unknown; COO owns it"])

    assert "1. What is the financial exposure?" in messages[4]
    assert llm.calls.index("challenge") < llm.calls.index("write_summary")
    assert llm.summary_args["challenge_answers"] == "Exposure unknown; COO owns it"
    assert result["summary"]


def test_confirmation_has_at_most_four_bullets_and_request_is_passed_on():
    llm = FakeLLM()
    _, result = run(llm, ["Ownership", "F1 causes F2", "Story", "2"], request="3 paragraphs / 600 words")

    bullets = result["confirmation"].splitlines()
    assert len(bullets) == 4
    assert [b.split(":")[0] for b in bullets] == [
        "- Root cause", "- Key finding relationships", "- Storyline", "- Tone",
    ]
    assert llm.summary_args["request"] == "3 paragraphs / 600 words"
    assert llm.summary_args["confirmed"] == result["confirmation"]


@pytest.mark.parametrize("step", prompts.STEPS)
def test_every_step_has_question_proposal_task_and_closing(step):
    assert step.question and step.propose and step.closing
