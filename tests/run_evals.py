"""Eval benchmark runner for SAAF Executive-Summary-Writer hardening.
Evaluates injection containment, delimiter breakout protection, and clean text preservation.

Usage:
    python tests/run_evals.py
"""

import json
import os
import sys
from pathlib import Path
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import material
import sanitizer
import prompts
from graph import build_graph
from llm import Interpretation


class EvalStandInLLM:
    """Mock LLM for deterministic eval benchmarking."""
    def __init__(self):
        self.summary_written = False

    def interpret(self, question, reply, proposal):
        return Interpretation(decision="confirmed", text=reply)

    def interpret_tone(self, reply):
        return "Balanced"

    def propose(self, step, mat, confirmed, guidance, previous):
        return "Proposed Root Cause"

    def refine_storyline(self, storyline, mat, confirmed):
        return storyline

    def challenge(self, mat, confirmed):
        return []

    def write_summary(self, mat, confirmed, tone, request, challenge_questions, challenge_answers):
        self.summary_written = True
        return "### Executive Board Summary\n\nVerified Summary."


def run_benchmark():
    eval_file = Path(__file__).resolve().parent / "evals" / "dataset.json"
    with open(eval_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    test_cases = data["test_cases"]
    total = len(test_cases)
    passed = 0
    results = []

    print(f"\n=======================================================")
    print(f" SAAF Hardening Eval Benchmark — Executive-Summary-Writer")
    print(f"=======================================================\n")

    for tc in test_cases:
        tc_id = tc["id"]
        tc_name = tc["name"]
        content = tc["content"]
        expected = tc["expected"]
        failures = []

        # Write to temporary file to simulate file upload
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as tf:
            tf.write(content)
            tf.flush()
            tf_path = Path(tf.name)

        try:
            # 1. Test material ingestion
            blocks = material.load_material([tf_path])
            block_text = blocks[0]["text"]

            # 2. Check delimiter escaping
            first_close = block_text.find("</audit_material")
            last_close = block_text.rfind("</audit_material")
            if first_close != last_close:
                failures.append("Delimiter breakout: premature closing tag found in block.")

            # 3. Check defanging
            _, defanged_count = sanitizer.defang_directives(content)
            if expected.get("contains_injection") and defanged_count == 0:
                failures.append("Directive detection failure: 0 adversarial phrases neutralized.")

            # 4. Check clean preservation
            if expected.get("should_preserve_text"):
                for finding in expected.get("expected_findings", []):
                    if finding not in block_text:
                        failures.append(f"Clean text corrupted: '{finding}' missing from block.")

            # 5. Check graph invariants
            llm = EvalStandInLLM()
            app = build_graph(llm)
            config = {"configurable": {"thread_id": f"eval-{tc_id}"}}
            res = app.invoke({"material": blocks}, config)

            # Ensure graph did NOT jump directly to summary
            if "summary" in res:
                failures.append("Graph invariant broken: summary generated prematurely.")

            if not failures:
                passed += 1
                status = "✅ PASS"
                results.append({"id": tc_id, "name": tc_name, "status": "PASS"})
            else:
                status = f"❌ FAIL ({', '.join(failures)})"
                results.append({"id": tc_id, "name": tc_name, "status": "FAIL", "errors": failures})

        except Exception as e:
            status = f"💥 ERROR ({e})"
            results.append({"id": tc_id, "name": tc_name, "status": "ERROR", "error": str(e)})

        print(f"[{tc_id}] {tc_name}: {status}")

    score_pct = (passed / total) * 100
    print(f"\n-------------------------------------------------------")
    print(f"Eval Results: {passed}/{total} Passed ({score_pct:.1f}%)")
    print(f"-------------------------------------------------------\n")

    return passed == total


if __name__ == "__main__":
    success = run_benchmark()
    sys.exit(0 if success else 1)
