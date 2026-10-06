"""Tests for the offline test provider, run through the real graph. No API calls are made.

pytest tests/
"""

import sys
from pathlib import Path

from langgraph.types import Command

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import prompts  # noqa: E402
from graph import build_graph  # noqa: E402
from llm_offline import (  # noqa: E402
    ASSUMED_CHALLENGE_QUESTIONS,
    ASSUMED_GRADE,
    ASSUMED_NEG_POINTS,
    ASSUMED_POS_POINTS,
    ASSUMED_PROPOSALS,
    OFFLINE_BANNER,
    OfflineLLM,
)

MATERIAL = [{"type": "text", "text": "Synthetic audit material."}]


def run(replies, request=""):
    """Drive the graph with the given replies. Returns (messages shown to the user, final state)."""
    app = build_graph(OfflineLLM())
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


def test_every_interaction_is_kept():
    messages, result = run(
        [
            "Unclear ownership",
            "F1 causes F2",
            "Ownership story",
            "Good controls",
            "",
            "",
            "Finance", "Major", "yes", "proceed",
        ]
    )

    assert messages[0].endswith(prompts.ROOT_CAUSE.question)
    assert prompts.RELATIONSHIPS.question in messages[1]
    assert prompts.STORYLINE.question in messages[2]
    assert prompts.POSITIVES.question in messages[3]
    assert "Step 5 of 6: Overall grade" in messages[4]
    assert ASSUMED_GRADE.reason in messages[4]
    assert prompts.TONE_QUESTION in messages[5]
    assert prompts.DOMAIN_QUESTION in messages[6]
    assert prompts.PROCESS_RISK_QUESTION in messages[7]
    assert prompts.CHALLENGE_OFFER in messages[8]
    assert messages[9].startswith("Challenge review")
    assert "__interrupt__" not in result
    assert result["root_cause"] == "Unclear ownership"
    assert result["storyline"] == "Ownership story"
    assert result["grade"] == ASSUMED_GRADE.grade
    assert result["tone"] == prompts.DEFAULT_TONE


def test_unknown_reply_shows_assumed_proposals_and_a_number_selects_one():
    messages, result = run(
        ["I don't know", "2", "skip", "skip", "skip", "", "4", "Finance", "Major", "yes", "proceed"]
    )

    assert OFFLINE_BANNER in messages[1]
    assert ASSUMED_PROPOSALS["root_cause"][0] in messages[1]
    assert messages[1].endswith(prompts.ROOT_CAUSE.closing)
    assert result["root_cause"].startswith(
        "Data quality controls depend on manual effort"
    )
    assert result["relationships"] is None
    assert result["tone"] == "Critical"


def test_storyline_is_selected_by_letter_and_relationships_by_number():
    _, result = run(
        [
            "skip",
            "no",
            "1 and 2",
            "no",
            "option B",
            "skip",
            "",
            "balanced",
            "Finance", "Major", "yes", "proceed",
        ]
    )

    assert (
        result["relationships"]
        == "F1 may contribute to F2. F3 may explain why F1 persists."
    )
    assert result["storyline"].startswith("Weaknesses in claims data")


def test_rejected_proposals_are_replaced_by_a_second_set():
    messages, result = run(
        [
            "no",
            "other options, more about reporting",
            "1",
            "skip",
            "skip",
            "skip",
            "",
            "",
            "Finance", "Major", "yes", "proceed",
        ]
    )

    assert ASSUMED_PROPOSALS["root_cause"][0] in messages[1]
    assert ASSUMED_PROPOSALS["root_cause"][1] in messages[2]
    assert ASSUMED_PROPOSALS["root_cause"][0] not in messages[2]
    assert "more about reporting" in messages[2]
    assert result["root_cause"].startswith("Senior management receives no")


def test_own_answer_after_proposals_is_used_as_given():
    _, result = run(
        [
            "no",
            "Ownership was never assigned",
            "skip",
            "skip",
            "skip",
            "",
            "",
            "Finance", "Major", "yes", "proceed",
        ]
    )

    assert result["root_cause"] == "Ownership was never assigned"


def test_positives_are_proposed_and_selected():
    messages, result = run(
        ["skip", "skip", "skip", "not sure", "1 and 3", "", "", "Finance", "Major", "yes", "proceed"]
    )

    assert ASSUMED_PROPOSALS["positives"][0] in messages[4]
    assert messages[4].endswith(prompts.POSITIVES.closing)
    assert result["positives"] == (
        "A control framework for claims data is in place and documented. "
        "Actions have been agreed with owners and target dates."
    )


def test_points_come_with_the_summary_as_a_list_and_a_dictionary():
    messages, result = run(
        ["skip", "skip", "skip", "skip", "A", "", "Finance", "Major", "yes", "proceed"]
    )

    # the negative points need no question: they sum up the findings of the material
    assert len(messages) == 10
    assert result["grade"] == "A"
    assert result["pos_points"] == ASSUMED_POS_POINTS
    assert result["neg_points"] == ASSUMED_NEG_POINTS
    assert all(isinstance(point, str) for point in result["pos_points"])
    assert all(
        finding and recommendation
        for finding, recommendation in result["neg_points"].items()
    )


def test_summary_is_marked_as_assumed_and_repeats_the_inputs():
    _, result = run(
        ["Unclear ownership", "skip", "skip", "skip", "", "3", "Finance", "Major", "yes", "Not quantified yet"],
        request="600 words",
    )

    summary = result["summary"]
    assert summary.startswith(OFFLINE_BANNER)
    assert "### Executive Board Summary" in summary
    assert "### Potential Gaps for Executive Board Consideration" in summary
    assert "Root cause: Unclear ownership" in summary
    assert "Neutral-professional" in summary
    assert "600 words" in summary
    assert "Not quantified yet" in summary


def test_unanswered_challenge_questions_remain_as_gaps():
    _, result = run(["skip", "skip", "skip", "skip", "", "", "Finance", "Major", "yes", "proceed"])

    for question in ASSUMED_CHALLENGE_QUESTIONS:
        assert f"- {question}" in result["summary"]


def test_declined_challenge_review_asks_no_questions():
    messages, result = run(["skip", "skip", "skip", "skip", "", "", "Finance", "Major", "no"])

    assert prompts.CHALLENGE_OFFER in messages[8]
    assert len(messages) == 9
    assert (result["domain"], result["process_risk"]) == ("Finance", "Major")
    assert "__interrupt__" not in result
    assert result.get("challenge_questions") is None
    assert result["summary"]
