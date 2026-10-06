"""Tests for the shared step logic of the providers. No API calls are made.

pytest tests/
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import prompts  # noqa: E402
from llm import BaseLLM, BoardSummary, summary_words  # noqa: E402

MATERIAL = [{"type": "text", "text": "Synthetic audit material."}]


def summary(words):
    return (
        "### Executive Board Summary\n\n"
        + "word " * words
        + "\n\n### Potential Gaps for Executive Board Consideration\n\n- An open question."
    )


class ScriptedLLM(BaseLLM):
    """Returns the next scripted summary and keeps the tasks it was given."""

    def __init__(self, lengths, points=3):
        self.lengths = list(lengths)
        self.points = points
        self.tasks = []

    def _parsed(self, task, schema, material=None, effort="high"):
        self.tasks.append(task)
        return BoardSummary(
            exe_summary=summary(self.lengths.pop(0)),
            pos_points=[f"Point {n}." for n in range(self.points)],
        )


def write(llm):
    return llm.write_summary(MATERIAL, "- Tone: Balanced", "Balanced", "", [], "")


def test_only_the_summary_itself_is_counted():
    assert summary_words(summary(120)) == 120


def test_summary_within_the_limit_is_kept():
    llm = ScriptedLLM([prompts.MAX_SUMMARY_WORDS])
    result = write(llm)

    assert len(llm.tasks) == 1
    assert f"never more than {prompts.MAX_SUMMARY_WORDS}" in llm.tasks[0]
    assert summary_words(result.exe_summary) == prompts.MAX_SUMMARY_WORDS


def test_summary_that_is_far_too_long_is_asked_for_again_once():
    llm = ScriptedLLM([1000, 250])
    result = write(llm)

    assert len(llm.tasks) == 2
    assert "has 1000 words" in llm.tasks[1]
    assert summary_words(result.exe_summary) == 250

    # a second long one is kept: the deck writer then warns about the slide
    llm = ScriptedLLM([1000, 900])
    assert summary_words(write(llm).exe_summary) == 900
    assert len(llm.tasks) == 2


def test_no_more_positive_points_than_fit_the_box():
    result = write(ScriptedLLM([100], points=9))
    assert len(result.pos_points) == prompts.MAX_POS_POINTS
