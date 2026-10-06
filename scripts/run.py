"""Entry point: guides the audit manager through the preparation phase in the terminal, then writes
the Executive Board summary. The output is a JSON file with the summary ("exe_summary"), the positive
points ("pos_points", a list), the main findings with a recommendation each ("neg_points", finding
-> recommendation) and the overall grade ("grade", A-D).

    python scripts/run.py                                    # the sample .pptx report
    python scripts/run.py report.docx
    python scripts/run.py upload.bin --input-source-type xlsx
"""

import argparse
import json
import logging
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import anthropic
from langgraph.types import Command

from graph import build_graph
from llm import BaseLLM, ClaudeLLM
from material import (
    DEFAULT_SOURCE_TYPE,
    SOURCE_TYPES,
    default_source,
    load_material,
)

logger = logging.getLogger(__name__)

QUIT_WORDS = {"quit", "exit"}
API_CHOICES = {
    "1": "openai",
    "openai": "openai",
    "2": "claude",
    "claude": "claude",
    "3": "offline",
    "offline": "offline",
}


def _ask(message: str) -> str:
    print(f"\n{message}\n")
    try:
        return input("> ").strip()
    except EOFError:
        return "quit"


def _choose_api(preselected: Optional[str]) -> Optional[str]:
    """Ask which API to use, unless it was given on the command line. Returns None when the user quits."""
    if preselected:
        return preselected
    print(
        "Which API do you want to use?\n  1. OpenAI\n  2. Claude\n"
        "  3. Offline test (no API, assumed AI output)\n"
    )
    while True:
        try:
            choice = input("> ").strip().lower()
        except EOFError:
            return None
        if choice in QUIT_WORDS:
            return None
        if choice in API_CHOICES:
            return API_CHOICES[choice]
        print("Please enter 1 for OpenAI, 2 for Claude or 3 for the offline test.")


def _build_llm(api: str) -> BaseLLM:
    if api == "openai":
        from llm_openai import (
            OpenAILLM,
        )  # imported here so the Claude option does not need the OpenAI packages

        return OpenAILLM()
    if api == "offline":
        from llm_offline import OfflineLLM

        return OfflineLLM()
    return ClaudeLLM()


def main() -> int:
    parser = argparse.ArgumentParser(description="Executive Summary Writer")
    parser.add_argument(
        "files",
        nargs="*",
        type=Path,
        help="Audit material. If omitted, the sample of the input source type is loaded",
    )
    parser.add_argument(
        "--input-source-type",
        choices=SOURCE_TYPES,
        help="How to read the files. If omitted, taken from each file's extension; "
        f"without files the default is {DEFAULT_SOURCE_TYPE}",
    )
    parser.add_argument(
        "--api",
        choices=["openai", "claude", "offline"],
        help="API to use; asked at the start if omitted",
    )
    parser.add_argument(
        "--request",
        default="",
        help='Your request, e.g. "3 paragraphs / 600 words, factual tone"',
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("./output"),
        help="Folder for the saved summary",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Also log token usage per model call",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if args.verbose:
        logging.getLogger("llm").setLevel(logging.DEBUG)
        logging.getLogger("llm_openai").setLevel(logging.DEBUG)

    source_type = args.input_source_type
    try:
        if not args.files:
            source_type = source_type or DEFAULT_SOURCE_TYPE
            args.files = [default_source(source_type)]
            print(f"No file given. Loading the sample: {args.files[0]}")
        missing = [str(p) for p in args.files if not p.is_file()]
        if missing:
            print(f"[!] File not found: {', '.join(missing)}")
            return 2
        material = load_material(args.files, source_type)
    except ValueError as exc:
        print(f"[!] {exc}")
        return 2

    api = _choose_api(args.api)
    if api is None:
        print("Stopped. No summary was written.")
        return 0
    try:
        llm = _build_llm(api)
    except RuntimeError as exc:
        print(f"[!] {exc}")
        return 1

    app = build_graph(llm)
    config = {"configurable": {"thread_id": str(uuid.uuid4())}}
    print(f"\nExecutive Summary Writer ({llm.name}). Type 'quit' to stop.")

    try:
        result = app.invoke(
            {"material": material, "request": args.request}, config
        )
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
        print(
            "[!] Authentication failed. Set ANTHROPIC_API_KEY and run again."
        )
        return 1
    except anthropic.RateLimitError:
        print(
            "[!] Rate limit reached after retries. Wait a moment and run again."
        )
        return 1
    except anthropic.APIStatusError as exc:
        print(f"[!] API error {exc.status_code}: {exc.message}")
        return 1
    except anthropic.APIConnectionError:
        print(
            "[!] Could not reach the Anthropic API. Check the network connection."
        )
        return 1
    except RuntimeError as exc:
        print(f"[!] {exc}")
        return 1
    except Exception as exc:
        if not type(exc).__module__.startswith("openai"):
            raise
        print(f"[!] OpenAI API error: {exc}")
        return 1

    print(
        f"\nConfirmed for the Executive Board summary:\n{result['confirmation']}\n"
    )
    output = {
        "exe_summary": result["summary"],
        "pos_points": result["pos_points"],
        "neg_points": result["neg_points"],
        "grade": result["grade"],
    }
    print(output["exe_summary"])
    print(f"\nOverall grade: {output['grade']}")
    print("\nPositive points:")
    for point in output["pos_points"]:
        print(f"- {point}")
    print("\nNegative points and recommendations:")
    for finding, recommendation in output["neg_points"].items():
        print(f"- {finding}\n  -> {recommendation}")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    out_file = (
        args.output_dir
        / f"executive-summary_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    )
    out_file.write_text(
        json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"\n[+] Saved to {out_file}")

    # a report deck also gets the summary and the points on its own executive summary slide
    deck = next(
        (
            p
            for p in args.files
            if (source_type or p.suffix.lower().lstrip(".")) == "pptx"
        ),
        None,
    )
    if deck is not None:
        from report_writer import write_summary_to_deck

        deck_file = args.output_dir / f"{deck.stem}_summary_filled{deck.suffix}"
        try:
            number = write_summary_to_deck(
                deck,
                output["exe_summary"],
                deck_file,
                output["pos_points"],
                output["neg_points"],
                llm.name,
                output["grade"],
            )
        except ValueError as exc:
            print(f"[!] The summary was not put on the slide: {exc}")
        else:
            print(
                f"[+] Summary, positive aspects and main findings written on slide {number} of {deck_file}"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
