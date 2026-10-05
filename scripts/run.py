"""Entry point: guides the audit manager through the preparation phase in the terminal, then writes
the Executive Board summary.

    python scripts/run.py samples/synthetic-audit-report.md
"""
import argparse
import logging
import sys
import uuid
from datetime import datetime
from pathlib import Path

import anthropic
from langgraph.types import Command

from graph import build_graph
from llm import ClaudeLLM, MODEL_NAME
from material import load_material

logger = logging.getLogger(__name__)

QUIT_WORDS = {"quit", "exit"}


def _ask(message: str) -> str:
    print(f"\n{message}\n")
    try:
        return input("> ").strip()
    except EOFError:
        return "quit"


def main() -> int:
    parser = argparse.ArgumentParser(description="Executive Summary Writer")
    parser.add_argument("files", nargs="+", type=Path, help="Audit material: .txt, .md, .docx or .pdf")
    parser.add_argument("--request", default="", help='Your request, e.g. "3 paragraphs / 600 words, factual tone"')
    parser.add_argument("--output-dir", type=Path, default=Path("./output"), help="Folder for the saved summary")
    parser.add_argument("--verbose", action="store_true", help="Also log token usage per model call")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if args.verbose:
        logging.getLogger("llm").setLevel(logging.DEBUG)

    missing = [str(p) for p in args.files if not p.is_file()]
    if missing:
        print(f"[!] File not found: {', '.join(missing)}")
        return 2
    try:
        material = load_material(args.files)
    except ValueError as exc:
        print(f"[!] {exc}")
        return 2

    app = build_graph(ClaudeLLM())
    config = {"configurable": {"thread_id": str(uuid.uuid4())}}
    print(f"Executive Summary Writer ({MODEL_NAME}). Type 'quit' to stop.")

    try:
        result = app.invoke({"material": material, "request": args.request}, config)
        while "__interrupt__" in result:
            reply = _ask(result["__interrupt__"][0].value["message"])
            if reply.lower() in QUIT_WORDS:
                print("Stopped. No summary was written.")
                return 0
            result = app.invoke(Command(resume=reply), config)
    except KeyboardInterrupt:
        print("\n[!] Interrupted by user. No summary was written.")
        return 130
    except anthropic.AuthenticationError:
        print("[!] Authentication failed. Set ANTHROPIC_API_KEY and run again.")
        return 1
    except anthropic.RateLimitError:
        print("[!] Rate limit reached after retries. Wait a moment and run again.")
        return 1
    except anthropic.APIStatusError as exc:
        print(f"[!] API error {exc.status_code}: {exc.message}")
        return 1
    except anthropic.APIConnectionError:
        print("[!] Could not reach the Anthropic API. Check the network connection.")
        return 1
    except RuntimeError as exc:
        print(f"[!] {exc}")
        return 1

    print(f"\nConfirmed for the Executive Board summary:\n{result['confirmation']}\n")
    print(result["summary"])

    args.output_dir.mkdir(parents=True, exist_ok=True)
    out_file = args.output_dir / f"executive-summary_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    out_file.write_text(
        f"> Confirmed with the audit manager:\n>\n"
        + "\n".join(f"> {line}" for line in result["confirmation"].splitlines())
        + f"\n\n{result['summary']}\n",
        encoding="utf-8",
    )
    print(f"\n[+] Saved to {out_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
