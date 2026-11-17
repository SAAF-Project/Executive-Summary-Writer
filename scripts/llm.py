"""Calls Claude to draft the Executive Board summary."""

from typing import Any, Optional

import anthropic

from prompts import SUMMARY_PROMPT, SYSTEM_PROMPT

MODEL = "claude-sonnet-5-5"
MAX_TOKENS = 600


def write_summary(
    findings: str, root_cause: str, client: Optional[Any] = None
) -> str:
    """Ask Claude to write the Executive Board summary."""
    client = client or anthropic.Anthropic()
    message = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": SUMMARY_PROMPT.format(
                    findings=findings, root_cause=root_cause
                ),
            }
        ],
    )
    return "".join(
        block.text for block in message.content if block.type == "text"
    ).strip()
