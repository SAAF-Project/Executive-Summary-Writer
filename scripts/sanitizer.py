"""Input sanitization, delimiter escaping, and cryptographic nonce fencing for untrusted audit evidence."""

import logging
import re
import secrets
from typing import Tuple

logger = logging.getLogger(__name__)

# Maximum character threshold per single evidence document to prevent context exhaustion
MAX_DOC_CHARS = 500_000

# High-confidence prompt injection directive patterns
DIRECTIVE_PATTERNS = [
    r"\[?\bSYSTEM\s+(?:INSTRUCTION\s+)?OVERRIDE\b\]?",
    r"\bignore\s+(?:all\s+)?(?:previous|prior)\s+instructions\b",
    r"\bdisregard\s+(?:all\s+)?instructions\b",
    r"\bforget\s+(?:all\s+)?(?:previous|prior)\s+instructions\b",
    r"\byou\s+are\s+now\s+in\s+[a-zA-Z\s]+mode\b",
    r"\bdeveloper\s+(?:audit\s+)?command\b",
    r"\bprint\s+(?:your\s+)?(?:entire\s+)?system\s+prompt\b",
    r"\boutput\s+(?:the\s+)?(?:entire\s+)?system\s+prompt\b",
    r"\[?\bINSTRUCTION\s+OVERRIDE\b\]?",
]

COMPILED_DIRECTIVES = [re.compile(p, re.IGNORECASE) for p in DIRECTIVE_PATTERNS]


def generate_nonce() -> str:
    """Generate a cryptographically secure 16-byte (32 hex characters) nonce."""
    return secrets.token_hex(16)


def escape_delimiters(text: str, tag_name: str) -> str:
    """Escape any nested or premature opening and closing XML tags for the given tag name.

    Ensures that content within the file cannot prematurely close or forge the container tag.
    """
    # Replace closing tags: </tag_name...> -> &lt;/tag_name...&gt;
    close_pattern = re.compile(rf"</\s*{re.escape(tag_name)}[^>]*>", re.IGNORECASE)
    text = close_pattern.sub(rf"&lt;/{tag_name}&gt;", text)

    # Replace opening tags: <tag_name...> -> &lt;tag_name...&gt;
    open_pattern = re.compile(rf"<\s*{re.escape(tag_name)}[^>]*>", re.IGNORECASE)
    text = open_pattern.sub(rf"&lt;{tag_name}&gt;", text)

    return text


def defang_directives(text: str) -> Tuple[str, int]:
    """Scan and defang adversarial prompt injection directives in untrusted text.

    Returns the sanitized text and the count of defanged directives.
    """
    total_matches = 0

    def _replace(match: re.Match) -> str:
        nonlocal total_matches
        total_matches += 1
        matched_text = match.group(0)
        logger.warning("Neutralized potential prompt injection directive: %r", matched_text)
        return "[DEFANGED_INSTRUCTION]"


    sanitized = text
    for pattern in COMPILED_DIRECTIVES:
        sanitized = pattern.sub(_replace, sanitized)

    return sanitized, total_matches


def sanitize_evidence(text: str, tag_name: str = "audit_material") -> Tuple[str, str, int]:
    """Full intake pipeline: length bounding, directive defanging, tag escaping, and nonce fencing.

    Returns:
        (fenced_block_text, nonce, defanged_count)
    """
    # 1. Enforce length budget (prevent unbounded context flooding)
    if len(text) > MAX_DOC_CHARS:
        logger.warning(
            "Document exceeded character limit (%d > %d); truncating tail.",
            len(text),
            MAX_DOC_CHARS,
        )
        text = text[:MAX_DOC_CHARS] + "\n\n[WARNING: Document truncated at character limit]"

    # 2. Defang high-confidence instruction directives
    defanged_text, defanged_count = defang_directives(text)

    # 3. Escape all container tags inside the text
    escaped_text = escape_delimiters(defanged_text, tag_name)

    # 4. Generate dynamic cryptographic boundary nonce
    nonce = generate_nonce()

    fenced_block = (
        f'<{tag_name} nonce="{nonce}">\n'
        f"{escaped_text.strip()}\n"
        f'</{tag_name} nonce="{nonce}">'
    )

    return fenced_block, nonce, defanged_count
