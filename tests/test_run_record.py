"""Tests for the record of a run and for playing it back. No API calls are made.

pytest tests/
"""

import json
import sys
from pathlib import Path

import pytest
from langgraph.types import Command

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from graph import build_graph  # noqa: E402
from llm_offline import ASSUMED_GRADE, OfflineLLM  # noqa: E402
from run_record import ReplayLLM, TracingLLM, save_trace  # noqa: E402

MATERIAL = [{"type": "text", "text": "Synthetic audit material."}]
REPLIES = ["no", "2", "skip", "skip", "skip", "B", "3", "HR", "Major", "yes", "proceed"]


def run(llm, replies=REPLIES):
    app = build_graph(llm)
    config = {"configurable": {"thread_id": "test"}}
    result = app.invoke({"material": MATERIAL, "request": ""}, config)
    for reply in replies:
        result = app.invoke(Command(resume=reply), config)
    assert "__interrupt__" not in result
    return result


def test_every_model_call_is_recorded_with_input_and_output():
    llm = TracingLLM(OfflineLLM())
    run(llm)

    assert llm.name == OfflineLLM.name
    assert [call["call"] for call in llm.calls] == [
        "interpret",  # root cause: not known
        "propose",
        "interpret",  # option 2
        "interpret",
        "interpret",
        "interpret",
        "suggest_grade",
        "challenge",
        "write_summary",
        "summarise_findings",
    ]
    proposal = llm.calls[1]
    assert proposal["input"]["step"] == "root_cause"
    assert "Proposed root cause" in proposal["output"]
    # the audit material is not repeated in every call
    assert all("material" not in call["input"] for call in llm.calls)
    grade = next(c for c in llm.calls if c["call"] == "suggest_grade")
    assert grade["output"] == ASSUMED_GRADE.model_dump()
    json.dumps(llm.calls)  # everything that is recorded can be written as JSON


def test_a_saved_record_gives_the_same_run_again(tmp_path):
    llm = TracingLLM(OfflineLLM())
    first = run(llm)
    # give the recorded outputs a mark, so the replay can be told from the offline provider
    calls = json.loads(json.dumps(llm.calls))
    for call in calls:
        if call["call"] == "write_summary":
            call["output"]["exe_summary"] = "### Executive Board Summary\n\nRecorded."
            call["output"]["pos_points"] = ["Recorded point."]
        if call["call"] == "suggest_grade":
            call["output"] = {"grade": "D", "reason": "Recorded reason."}
    path = tmp_path / "run_trace.json"
    save_trace(path, {"model": "some-model", "calls": calls})

    replay = ReplayLLM(path)
    assert replay.name == "replay of some-model"
    app = build_graph(replay)
    config = {"configurable": {"thread_id": "replay"}}
    result = app.invoke({"material": MATERIAL, "request": ""}, config)
    for reply in REPLIES[:5]:
        result = app.invoke(Command(resume=reply), config)
    assert "suggest the overall grade D" in result["__interrupt__"][0].value["message"]
    for reply in ["", *REPLIES[6:]]:
        result = app.invoke(Command(resume=reply), config)

    assert result["summary"] == "### Executive Board Summary\n\nRecorded."
    assert result["pos_points"] == ["Recorded point."]
    assert result["grade"] == "D"
    assert result["root_cause"] == first["root_cause"]
    assert result["neg_points"] == first["neg_points"]


def test_replay_falls_back_to_the_offline_output_when_the_record_runs_out(tmp_path):
    path = tmp_path / "run_trace.json"
    save_trace(path, {"model": "some-model", "calls": []})

    result = run(ReplayLLM(path))
    assert result["grade"] == "B"
    assert result["summary"]


def test_unreadable_record_is_refused(tmp_path):
    path = tmp_path / "broken.json"
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(RuntimeError, match="Could not read the record"):
        ReplayLLM(path)
