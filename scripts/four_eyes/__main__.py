"""Command line: re-perform an approval log, or show the phrase for a file.

    python -m four_eyes verify-log path/to/four-eyes-log.jsonl
    python -m four_eyes phrase path/to/report.md
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .gate import FourEyesError, short_code, verify_log


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="four-eyes", description="Four Eyes sign-off tools.")
    parser.add_argument("--version", action="version", version=f"four-eyes {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("verify-log", help="Check every line of an approval log (needs FOUR_EYES_KEY)")
    check.add_argument("log", type=Path)

    phrase = sub.add_parser("phrase", help="Show what to type to approve a file's exact content")
    phrase.add_argument("file", type=Path)

    args = parser.parse_args(argv)
    if args.command == "phrase":
        print(f"APPROVE {short_code(args.file.read_bytes())}")
        return 0

    try:
        ok, notes = verify_log(args.log)
    except FourEyesError as exc:
        print(f"four-eyes: {exc}", file=sys.stderr)
        return 2
    for note in notes:
        print(("OK    " if ok else "FAIL  ") + note)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
