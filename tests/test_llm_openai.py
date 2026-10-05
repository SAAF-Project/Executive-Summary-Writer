"""Tests for the OpenAI provider with a fake client, so no API calls are made and the `openai`
package is not needed.

    pytest tests/
"""

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import prompts  # noqa: E402
from llm import Interpretation  # noqa: E402
from llm_openai import OpenAILLM  # noqa: E402

MATERIAL = [{"type": "text", "text": "Synthetic audit material."}]


class BadRequest(Exception):
    status_code = 400


class FakeClient:
    """Stands in for openai.OpenAI: records each request and returns the next scripted reply."""

    def __init__(self, replies, finish_reason="stop", reject_sampling=False):
        self.replies = list(replies)
        self.finish_reason = finish_reason
        self.reject_sampling = reject_sampling
        self.requests = []
        self.chat = SimpleNamespace(
            completions=SimpleNamespace(create=self._create)
        )

    def _create(self, **request):
        self.requests.append(request)
        if self.reject_sampling and "temperature" in request:
            raise BadRequest(
                "Unsupported value: 'temperature' does not support 0.0 with this model."
            )
        message = SimpleNamespace(content=self.replies.pop(0), refusal=None)
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=message, finish_reason=self.finish_reason
                )
            ],
            usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5),
        )


def make(replies, **kwargs):
    client = FakeClient(
        replies,
        **{
            k: v
            for k, v in kwargs.items()
            if k in ("finish_reason", "reject_sampling")
        },
    )
    llm = OpenAILLM(
        client=client,
        deployment="test-deployment",
        sampling=kwargs.get("sampling"),
    )
    return llm, client


def test_text_call_uses_chat_completions_with_system_prompt_and_material():
    llm, client = make(["| Option | Proposed root cause |"])
    reply = llm.propose(prompts.ROOT_CAUSE, MATERIAL, "", "", None)

    assert reply == "| Option | Proposed root cause |"
    request = client.requests[0]
    assert request["model"] == "test-deployment"
    assert request["messages"][0] == {
        "role": "system",
        "content": prompts.SYSTEM_PROMPT,
    }
    assert request["messages"][1]["content"].startswith(
        "Synthetic audit material."
    )
    assert prompts.ROOT_CAUSE.propose in request["messages"][1]["content"]
    assert "response_format" not in request


def test_structured_reply_is_requested_as_json_and_validated():
    llm, client = make(['{"decision": "unknown", "text": ""}'])
    result = llm.interpret("Question?", "No", None)

    assert result == Interpretation(decision="unknown", text="")
    request = client.requests[0]
    assert request["response_format"] == {"type": "json_object"}
    assert "JSON schema" in request["messages"][1]["content"]


def test_reply_that_does_not_match_the_schema_is_an_error():
    llm, _ = make(['{"decision": "maybe"}'])
    with pytest.raises(RuntimeError, match="expected format"):
        llm.interpret("Question?", "No", None)


def test_sampling_settings_are_dropped_once_if_the_model_rejects_them():
    llm, client = make(
        ["first", "second"],
        sampling={"temperature": 0.0, "top_p": 0.1},
        reject_sampling=True,
    )

    assert llm.refine_storyline("Story", MATERIAL, "") == "first"
    assert (
        "temperature" in client.requests[0]
        and "temperature" not in client.requests[1]
    )
    assert llm.refine_storyline("Story", MATERIAL, "") == "second"
    assert len(client.requests) == 3 and "top_p" not in client.requests[2]


def test_truncated_reply_is_an_error():
    llm, _ = make(["partial"], finish_reason="length")
    with pytest.raises(RuntimeError, match="cut off"):
        llm.refine_storyline("Story", MATERIAL, "")


def test_pdf_material_is_refused():
    llm, _ = make(["unused"])
    pdf = [
        {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": "",
            },
        }
    ]
    with pytest.raises(RuntimeError, match="PDF input"):
        llm.challenge(pdf, "- Root cause: x")
