"""Tests for scripts/material.py, prompts.py, llm.py and run.py.

No API key or network needed: the Claude call is replaced by a fake client
that records what it was sent and returns a fixed summary.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import llm  # noqa: E402
import material  # noqa: E402
import run  # noqa: E402
from prompts import SUMMARY_PROMPT, SYSTEM_PROMPT  # noqa: E402


class FakeTextBlock:
    type = "text"

    def __init__(self, text):
        self.text = text


class FakeMessage:
    def __init__(self, text):
        self.content = [FakeTextBlock(text)]


class FakeMessages:
    def __init__(self):
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return FakeMessage("### Executive Board Summary\n\nSynthetic summary.")


class FakeClient:
    def __init__(self):
        self.messages = FakeMessages()


def test_load_findings_reads_the_file(tmp_path):
    findings_file = tmp_path / "findings.txt"
    findings_file.write_text("Finding 1: missing approval.", encoding="utf-8")
    assert material.load_findings(findings_file) == "Finding 1: missing approval."


def test_load_findings_rejects_an_empty_file(tmp_path):
    findings_file = tmp_path / "empty.txt"
    findings_file.write_text("   ", encoding="utf-8")
    try:
        material.load_findings(findings_file)
        assert False, "expected a ValueError for an empty file"
    except ValueError as exc:
        assert "findings.txt" not in str(exc)  # message names the real file
        assert "empty.txt" in str(exc)


def test_write_summary_sends_findings_and_root_cause_to_the_model():
    client = FakeClient()
    result = llm.write_summary(
        "Finding 1: missing approval.", "Insufficient staffing.", client=client
    )
    assert result == "### Executive Board Summary\n\nSynthetic summary."
    sent = client.messages.calls[0]
    assert sent["system"] == SYSTEM_PROMPT
    prompt = sent["messages"][0]["content"]
    assert prompt == SUMMARY_PROMPT.format(
        findings="Finding 1: missing approval.",
        root_cause="Insufficient staffing.",
    )
    assert "Finding 1: missing approval." in prompt
    assert "Insufficient staffing." in prompt


def test_run_main_writes_the_summary_file(tmp_path, monkeypatch):
    findings_file = tmp_path / "findings.txt"
    findings_file.write_text("Finding 1: missing approval.", encoding="utf-8")

    monkeypatch.setattr("builtins.input", lambda prompt: "Insufficient staffing.")

    captured = {}

    def fake_write_summary(findings, root_cause):
        captured["findings"] = findings
        captured["root_cause"] = root_cause
        return "A synthetic summary."

    monkeypatch.setattr(run, "write_summary", fake_write_summary)

    exit_code = run.main([str(findings_file)])

    assert exit_code == 0
    assert captured["findings"] == "Finding 1: missing approval."
    assert captured["root_cause"] == "Insufficient staffing."
    out_file = tmp_path / "findings_summary.md"
    assert out_file.read_text(encoding="utf-8") == "A synthetic summary.\n"


def test_run_main_reports_a_missing_file(tmp_path):
    missing = tmp_path / "does-not-exist.txt"
    assert run.main([str(missing)]) == 1
