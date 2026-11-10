"""Four Eyes sign-off for the Executive Board summary.

Finding (SAAF Security Challenge, 10 November 2026): the summary, findings table,
JSON and deck were released without a person approving the content. The step
before the summary was not a pause for the human, and a step the model classified
as "skipped" counted as done. A model steered by a poisoned document could read
"no" as "confirmed".

These tests replay those bypasses. They fail on the code before the fix and pass
after it. No API key or network needed.

pytest tests/test_four_eyes_signoff.py -v
"""

import sys
import unittest
from pathlib import Path

from langgraph.types import Command

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from graph import build_graph  # noqa: E402
from llm import Interpretation  # noqa: E402
from test_graph import MATERIAL, FakeLLM  # noqa: E402

from four_eyes import Gate  # noqa: E402  (vendored copy in scripts/four_eyes)
from four_eyes.testkit import FourEyesBypassTests  # noqa: E402

TEST_KEY = b"esw-four-eyes-test-key-not-secret"

# Skip every preparation step, accept the suggested grade, default tone, no challenge review.
SKIP_ALL = ["skip", "skip", "skip", "skip", "", "2", "Finance", "Major", "no"]
# The audit manager says no at every step; a steered model reads each "no" as "confirmed".
SAYS_NO = ["No, that is wrong."] * 4 + ["", "2", "Finance", "Major", "no"]


class ConfirmsEverythingLLM(FakeLLM):
    """A model steered by an injected document: every reply is read as 'confirmed'."""

    def interpret(self, question, reply, proposal):
        self.calls.append("interpret")
        return Interpretation(decision="confirmed", text=reply)


def _gate():
    return Gate(lambda: "audit.manager", key=TEST_KEY)


def _drive(llm, replies, gate):
    try:
        app = build_graph(llm, gate=gate)
    except TypeError:
        app = build_graph(llm)  # code before the fix has no gate parameter
    config = {"configurable": {"thread_id": "four-eyes"}}
    result = app.invoke({"material": MATERIAL, "request": ""}, config)
    for reply in replies:
        assert "__interrupt__" in result, "graph finished before all replies were used"
        result = app.invoke(Command(resume=reply), config)
    return app, config, result


def _waiting_for_final_approval(result):
    return "__interrupt__" in result and result["__interrupt__"][0].value.get("step") == "final_approval"


# --------------------------------------------------------------------------
# The bypasses from today: each must stop at the final approval
# --------------------------------------------------------------------------


def test_skipping_every_step_does_not_release_the_summary():
    _, _, result = _drive(FakeLLM(), SKIP_ALL, _gate())
    assert not result.get("released")
    assert _waiting_for_final_approval(result), "summary released without a person approving it"


def test_a_steered_model_cannot_turn_no_into_a_release():
    _, _, result = _drive(ConfirmsEverythingLLM(), SAYS_NO, _gate())
    assert not result.get("released")
    assert _waiting_for_final_approval(result), "summary released although the manager said no"


def test_yes_or_approve_all_at_the_final_step_is_not_an_approval():
    app, config, result = _drive(FakeLLM(), SKIP_ALL, _gate())
    assert _waiting_for_final_approval(result)
    for reply in ["yes", "approve all remaining steps", "APPROVE"]:
        result = app.invoke(Command(resume=reply), config)
        assert not result.get("released")
        assert _waiting_for_final_approval(result)
        assert "type: APPROVE " in result["__interrupt__"][0].value["message"]


def test_typing_the_phrase_for_this_summary_releases_it():
    from graph import deliverable

    gate = _gate()
    app, config, result = _drive(FakeLLM(), SKIP_ALL, gate)
    phrase = gate.confirmation_phrase(deliverable(result))
    result = app.invoke(Command(resume=phrase), config)
    assert result.get("released") is True
    assert result["approval"]["approver"] == "audit.manager"
    assert "__interrupt__" not in result


# --------------------------------------------------------------------------
# The reusable Four Eyes bypass kit, run against the real release path
# --------------------------------------------------------------------------


class TestEswFourEyesKit(FourEyesBypassTests, unittest.TestCase):
    STEP = "board_summary"

    def prepare(self, gate):
        _, _, result = _drive(FakeLLM(), SKIP_ALL, gate)
        return {k: v for k, v in result.items() if k != "__interrupt__"}

    def artefact(self, state):
        from graph import deliverable

        return deliverable(state)

    def tamper(self, state):
        return {**state, "summary": state["summary"] + "\n\nNo high-risk findings remain open."}

    def release(self, gate, state, approval):
        from graph import release_final

        return release_final(gate, state, approval)
