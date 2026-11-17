"""Reads the findings the audit manager wrote."""

from pathlib import Path


def load_findings(path: Path) -> str:
    """Read the findings the user wrote, as plain text."""
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError(f"No text found in {path.name}")
    return text
