"""Entry point: asks for the root cause, then drafts the Executive Board summary.

Usage:
    python scripts/run.py findings.txt
"""

import argparse
import sys
from pathlib import Path
from typing import Optional, Sequence

from llm import write_summary
from material import load_findings

QUESTION = "What is the root cause do you have in mind? "


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("findings_file", type=Path, help="A .txt file of findings")
    parser.add_argument(
        "--output", type=Path, default=None, help="Where to save the summary (.md)"
    )
    args = parser.parse_args(argv)

    try:
        findings = load_findings(args.findings_file)
    except (OSError, ValueError) as exc:
        print(f"[!] {exc}")
        return 1

    root_cause = input(QUESTION).strip()
    summary = write_summary(findings, root_cause)

    out_file = args.output or args.findings_file.with_name(
        args.findings_file.stem + "_summary.md"
    )
    out_file.write_text(summary + "\n", encoding="utf-8")
    print(f"[+] Summary saved to {out_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
