"""Keeps a record of a run as JSON, and plays one back without a model.

Every model call of a run is recorded with its input and its output, next to the questions that were
put to the audit manager and their replies. The record is saved with the output of the run:

    output/executive-summary_<date>_<time>_trace.json

A saved record can be played back offline: the model outputs come from the file, in the order they
were given, and you answer the questions in the terminal again.

    python scripts/run.py report.pptx --replay output/executive-summary_<date>_<time>_trace.json
"""

import inspect
import json
import logging
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List

from pydantic import BaseModel

from llm import BoardSummary, Finding, GradeSuggestion, Interpretation
from llm_offline import OfflineLLM
from prompts import StepSpec

logger = logging.getLogger(__name__)

TRACE_VERSION = 1

# the model calls of a run, and how a recorded output is turned back into what the graph expects
CALLS = {
    "interpret": lambda out: Interpretation(**out),
    "interpret_tone": str,
    "propose": str,
    "refine_storyline": str,
    "suggest_grade": lambda out: GradeSuggestion(**out),
    "challenge": list,
    "write_summary": lambda out: BoardSummary(**out),
    "summarise_findings": lambda out: [Finding(**item) for item in out],
}


def _plain(value: Any) -> Any:
    """A value as it is written to JSON."""
    if isinstance(value, BaseModel):
        return value.model_dump()
    if isinstance(value, StepSpec):
        return value.key
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    return value


class TracingLLM:
    """Wraps a provider and records every model call: its name, its input and its output.

    The audit material is left out of the input: it is the same for every call and is named once in
    the record, by its files.
    """

    def __init__(self, llm: Any) -> None:
        self.llm = llm
        self.name = llm.name
        self.calls: List[Dict[str, Any]] = []

    def __getattr__(self, name: str) -> Any:
        target = getattr(self.llm, name)
        if name not in CALLS:
            return target

        def traced(*args: Any, **kwargs: Any) -> Any:
            given = inspect.signature(target).bind(*args, **kwargs).arguments
            output = target(*args, **kwargs)
            self.calls.append(
                {
                    "call": name,
                    "input": {
                        key: _plain(value)
                        for key, value in given.items()
                        if key != "material"
                    },
                    "output": _plain(output),
                }
            )
            return output

        return traced


def save_trace(path: Path, trace: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"version": TRACE_VERSION, **trace}, indent=2, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )


class ReplayLLM(OfflineLLM):
    """Plays back the model outputs of a saved record. No API, no network, no credentials.

    Each kind of call gives its recorded outputs in the order they were given. When the conversation
    takes another turn than the recorded one and a kind of call runs out, the assumed output of the
    offline test is used instead, and that is logged.
    """

    def __init__(self, path: Path) -> None:
        try:
            trace = json.loads(Path(path).read_text(encoding="utf-8"))
            calls = trace["calls"]
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise RuntimeError(f"Could not read the record {path}: {exc}") from exc
        self.name = f"replay of {trace.get('model', 'a saved run')}"
        self.recorded: Dict[str, List[Any]] = defaultdict(list)
        for call in calls:
            self.recorded[call["call"]].append(call["output"])


def _replayed(name: str) -> Any:
    def method(self: ReplayLLM, *args: Any, **kwargs: Any) -> Any:
        if self.recorded[name]:
            return CALLS[name](self.recorded[name].pop(0))
        logger.info(
            "(replay: no recorded output left for '%s', using the assumed offline output)",
            name,
        )
        return getattr(OfflineLLM, name)(self, *args, **kwargs)

    return method


for _name in CALLS:
    setattr(ReplayLLM, _name, _replayed(_name))
