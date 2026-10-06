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
from llm import (  # noqa: E402
    BoardSummary,
    Finding,
    GradeSuggestion,
    Interpretation,
)

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
        return (
            "Critical"
            if "critical" in reply.lower() or reply == "4"
            else "Balanced"
        )

    def propose(self, step, material, confirmed, guidance, previous):
        self.calls.append(f"propose:{step.key}")
        return f"OPTIONS for {step.key}" + (
            " (second round)" if previous else ""
        )

    def refine_storyline(self, storyline, material, confirmed):
        self.calls.append("refine_storyline")
        return f"Refined: {storyline}"

    def suggest_grade(self, material):
        self.calls.append("suggest_grade")
        return GradeSuggestion(grade="B", reason="One medium-risk finding.")

    def challenge(self, material, confirmed):
        self.calls.append("challenge")
        return self.challenge_questions

    def write_summary(
        self,
        material,
        confirmed,
        tone,
        request,
        challenge_questions,
        challenge_answers,
    ):
        self.calls.append("write_summary")
        self.summary_args = {
            "confirmed": confirmed,
            "tone": tone,
            "request": request,
            "challenge_questions": challenge_questions,
            "challenge_answers": challenge_answers,
        }
        return BoardSummary(
            exe_summary="### Executive Board Summary\n\nSynthetic summary.",
            pos_points=["Payment is well controlled."],
        )

    def summarise_findings(self, material):
        self.calls.append("summarise_findings")
        return [
            Finding(
                finding="Model is not up-to-date.",
                recommendation="There should be a product owner.",
                title="0002 – Model",
            )
        ]


def run(llm, replies, request=""):
    """Drive the graph with the given replies. Returns (messages shown to the user, final state)."""
    app = build_graph(llm)
    config = {"configurable": {"thread_id": "test"}}
    messages = []
    result = app.invoke({"material": MATERIAL, "request": request}, config)
    for reply in replies:
        assert (
            "__interrupt__" in result
        ), f"graph finished before reply {reply!r} was used"
        messages.append(result["__interrupt__"][0].value["message"])
        result = app.invoke(Command(resume=reply), config)
    return messages, result


def test_first_response_only_asks_step_1():
    llm = FakeLLM()
    app = build_graph(llm)
    result = app.invoke(
        {"material": MATERIAL}, {"configurable": {"thread_id": "t"}}
    )

    message = result["__interrupt__"][0].value["message"]
    assert message == f"{prompts.INTRO}\n\n{prompts.ROOT_CAUSE.question}"
    assert (
        llm.calls == []
    )  # no analysis and no summary before the first question
    assert "summary" not in result


def test_user_knows_everything_goes_straight_through():
    llm = FakeLLM()
    messages, result = run(
        llm,
        [
            "Unclear ownership",
            "F1 causes F2",
            "Ownership story",
            "Payment is well controlled",
            "",
            "2",
            "Finance", "Major", "no",
        ],
    )

    assert not any(call.startswith("propose") for call in llm.calls)
    assert result["root_cause"] == "Unclear ownership"
    assert result["relationships"] == "F1 causes F2"
    assert (
        result["storyline"] == "Refined: Ownership story"
    )  # a supplied storyline is strengthened
    assert result["positives"] == "Payment is well controlled"
    assert result["grade"] == "B"  # Enter accepts the suggested grade
    assert result["tone"] == "Balanced"
    assert result["summary"].startswith("### Executive Board Summary")
    # the points come back next to the summary: a list, and finding -> recommendation
    assert result["pos_points"] == ["Payment is well controlled."]
    assert result["neg_points"] == {
        "Model is not up-to-date.": "There should be a product owner."
    }
    # the findings table is filled straight after the summary, without a question
    assert llm.calls[-2:] == ["write_summary", "summarise_findings"]
    # each next question briefly confirms the previous answer
    assert messages[1].startswith("Root cause noted: Unclear ownership")
    assert prompts.RELATIONSHIPS.question in messages[1]


def test_summary_is_never_written_before_all_steps_are_done():
    llm = FakeLLM()
    app = build_graph(llm)
    config = {"configurable": {"thread_id": "gate"}}
    result = app.invoke(
        {
            "material": MATERIAL,
            "request": "Write an executive summary in 600 words",
        },
        config,
    )

    for reply in [
        "Please provide a summary",
        "Summarise in 600 words",
        "Write the summary now",
        "Just the summary please",
    ]:
        assert "write_summary" not in llm.calls
        assert "summary" not in result
        result = app.invoke(Command(resume=reply), config)

    # four replies only got us through steps 1-4; the graph is waiting at the
    # grade question, and a reply that is no grade does not get past it
    assert "Step 5 of 6: Overall grade" in result["__interrupt__"][0].value["message"]
    result = app.invoke(Command(resume="Write the summary"), config)
    assert "write_summary" not in llm.calls
    message = result["__interrupt__"][0].value["message"]
    assert message.startswith(prompts.GRADE_RETRY)
    assert "Step 5 of 6: Overall grade" in message


def test_unknown_root_cause_gets_proposals_and_stops_for_a_choice():
    llm = FakeLLM()
    messages, result = run(
        llm, ["No", "Option 2", "skip", "skip", "skip", "", "", "Finance", "Major", "no"]
    )

    assert llm.calls[:3] == ["interpret", "propose:root_cause", "interpret"]
    assert (
        messages[1]
        == f"OPTIONS for root_cause\n\n{prompts.ROOT_CAUSE.closing}"
    )
    assert result["root_cause"] == "Option 2"
    assert (
        prompts.RELATIONSHIPS.question in messages[2]
    )  # step 2 only starts after the choice


def test_rejected_proposals_are_proposed_again():
    llm = FakeLLM()
    messages, _ = run(
        llm,
        [
            "No",
            "None of these, try again",
            "Option 1",
            "skip",
            "skip",
            "skip",
            "",
            "",
            "Finance", "Major", "no",
        ],
    )

    assert llm.calls.count("propose:root_cause") == 2
    assert "(second round)" in messages[2]


def test_skipped_steps_and_default_tone():
    llm = FakeLLM()
    _, result = run(llm, ["skip", "skip", "skip", "skip", "", "", "Finance", "Major", "no"])

    assert all(result[step.key] is None for step in prompts.STEPS)
    assert result["tone"] == prompts.DEFAULT_TONE
    assert (
        "interpret_tone" not in llm.calls
    )  # an empty reply takes the default without a model call
    assert (
        "- Root cause: Skipped by the audit manager" in result["confirmation"]
    )
    assert "write_summary" in llm.calls


def test_storyline_chosen_from_proposals_is_not_refined():
    llm = FakeLLM()
    _, result = run(
        llm, ["skip", "skip", "No", "Option B", "skip", "", "4", "Finance", "Major", "no"]
    )

    assert "refine_storyline" not in llm.calls
    assert result["storyline"] == "Option B"
    assert result["tone"] == "Critical"


def test_unknown_positives_get_proposals():
    llm = FakeLLM()
    messages, result = run(
        llm, ["skip", "skip", "skip", "No", "1 and 2", "", "", "Finance", "Major", "no"]
    )

    assert messages[4] == f"OPTIONS for positives\n\n{prompts.POSITIVES.closing}"
    assert result["positives"] == "1 and 2"


def test_grade_is_suggested_from_the_findings_and_then_asked():
    llm = FakeLLM()
    messages, result = run(
        llm, ["skip", "skip", "skip", "skip", "c", "", "Finance", "Major", "no"]
    )

    assert llm.calls.count("suggest_grade") == 1
    assert (
        "Based on the findings listed in the report, I would suggest the overall grade B: "
        f"{prompts.GRADES['B']}"
    ) in messages[4]
    assert "One medium-risk finding." in messages[4]
    assert all(f"{g}. {text}" in messages[4] for g, text in prompts.GRADES.items())
    # the audit manager chose another grade than the suggested one
    assert result["grade"] == "C"
    assert messages[5].startswith("Overall grade noted: C")
    assert f"- Overall grade: C ({prompts.GRADES['C']})" in result["confirmation"]


def test_findings_are_summarised_without_a_question():
    llm = FakeLLM()
    messages, result = run(
        llm, ["skip", "skip", "skip", "skip", "", "", "Finance", "Major", "no"]
    )

    assert len(messages) == 9  # steps 1-6, the report header and the offer of a challenge review
    assert llm.calls.count("summarise_findings") == 1
    # the title links the line to its finding slide, where the owner is read
    assert result["neg_titles"] == {"Model is not up-to-date.": "0002 – Model"}
    assert result["neg_points"] == {
        "Model is not up-to-date.": "There should be a product owner."
    }


def test_challenge_questions_are_asked_before_the_summary():
    llm = FakeLLM(
        challenge_questions=[
            "What is the financial exposure?",
            "Who owns remediation?",
        ]
    )
    messages, result = run(
        llm,
        [
            "Ownership",
            "skip",
            "skip",
            "skip",
            "",
            "2",
            "Finance", "Major", "yes",
            "Exposure unknown; COO owns it",
        ],
    )

    assert messages[8].endswith(prompts.CHALLENGE_OFFER)
    assert "1. What is the financial exposure?" in messages[9]
    assert llm.calls.index("challenge") < llm.calls.index("write_summary")
    assert (
        llm.summary_args["challenge_answers"]
        == "Exposure unknown; COO owns it"
    )
    assert result["summary"]


@pytest.mark.parametrize(
    "reply, tone",
    [
        ("1", "Positive"),
        ("2", "Balanced"),
        ("3", "Neutral-professional"),
        ("4", "Critical"),
        ("critical", "Critical"),
        ("Neutral-professional", "Neutral-professional"),
    ],
)
def test_tone_by_number_or_name_is_read_without_the_model(reply, tone):
    llm = FakeLLM()
    app = build_graph(llm)
    config = {"configurable": {"thread_id": "tone"}}
    result = app.invoke({"material": MATERIAL}, config)
    for earlier in ["skip", "skip", "skip", "skip", ""]:
        result = app.invoke(Command(resume=earlier), config)

    question = result["__interrupt__"][0].value
    assert question["step"] == "tone"
    assert question["options"] == list(prompts.TONES)
    result = app.invoke(Command(resume=reply), config)
    assert "interpret_tone" not in llm.calls
    assert result["__interrupt__"][0].value["message"].startswith(
        f"Tone noted: {tone}"
    )


def test_tone_in_other_words_is_read_by_the_model():
    llm = FakeLLM()
    _, result = run(
        llm,
        ["skip", "skip", "skip", "skip", "", "rather critical please", "Finance", "Major", "no"],
    )

    assert "interpret_tone" in llm.calls
    assert result["tone"] == "Critical"


def test_report_header_is_asked_with_fixed_answers_and_without_the_model():
    llm = FakeLLM()
    app = build_graph(llm)
    config = {"configurable": {"thread_id": "header"}}
    result = app.invoke({"material": MATERIAL}, config)
    for reply in ["skip", "skip", "skip", "skip", "", ""]:
        result = app.invoke(Command(resume=reply), config)
    calls = list(llm.calls)

    question = result["__interrupt__"][0].value
    assert question["step"] == "domain"
    assert question["options"] == ["Finance", "HR", "Corporate", "Other"]
    # "Other" asks the audit manager to type the domain
    result = app.invoke(Command(resume="Other"), config)
    question = result["__interrupt__"][0].value
    assert question["message"] == prompts.DOMAIN_OTHER and "options" not in question
    result = app.invoke(Command(resume="IT"), config)

    question = result["__interrupt__"][0].value
    assert question["step"] == "process_risk"
    assert question["options"] == ["Minor", "Moderate", "Material", "Major"]
    assert question["message"].startswith("Domain noted: IT")
    result = app.invoke(Command(resume="severe"), config)
    assert result["__interrupt__"][0].value["message"].startswith(
        prompts.PROCESS_RISK_RETRY
    )
    result = app.invoke(Command(resume="material"), config)
    assert llm.calls == calls  # no model call for the header

    result = app.invoke(Command(resume="no"), config)
    assert result["domain"] == "IT"
    assert result["process_risk"] == "Material"


def test_challenge_review_is_only_done_when_asked_for():
    llm = FakeLLM(challenge_questions=["What is the financial exposure?"])
    messages, result = run(
        llm, ["skip", "skip", "skip", "skip", "", "", "Finance", "Major", "perhaps", "No"]
    )

    # a reply that is neither yes nor no gets the offer again
    assert messages[9] == f"{prompts.CHALLENGE_RETRY}\n\n{prompts.CHALLENGE_OFFER}"
    assert "challenge" not in llm.calls
    assert llm.summary_args["challenge_questions"] == []
    assert result["summary"]


def test_challenge_review_has_at_most_three_questions():
    llm = FakeLLM(challenge_questions=[f"Question {n}?" for n in range(1, 7)])
    messages, _ = run(
        llm, ["skip", "skip", "skip", "skip", "", "", "Finance", "Major", "yes", "proceed"]
    )

    assert "3. Question 3?" in messages[9]
    assert "Question 4?" not in messages[9]
    assert llm.summary_args["challenge_questions"] == [
        "Question 1?",
        "Question 2?",
        "Question 3?",
    ]


def test_confirmation_has_at_most_six_bullets_and_request_is_passed_on():
    llm = FakeLLM()
    _, result = run(
        llm,
        ["Ownership", "F1 causes F2", "Story", "Good controls", "D", "2", "Finance", "Major", "no"],
        request="3 paragraphs / 600 words",
    )

    bullets = result["confirmation"].splitlines()
    assert len(bullets) == 6
    assert [b.split(":")[0] for b in bullets] == [
        "- Root cause",
        "- Key finding relationships",
        "- Storyline",
        "- Positive aspects",
        "- Overall grade",
        "- Tone",
    ]
    assert llm.summary_args["request"] == "3 paragraphs / 600 words"
    assert llm.summary_args["confirmed"] == result["confirmation"]


@pytest.mark.parametrize("step", prompts.STEPS)
def test_every_step_has_question_proposal_task_and_closing(step):
    assert step.question and step.propose and step.closing
