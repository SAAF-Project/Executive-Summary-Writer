"""Offline test provider for the Executive Summary Writer: no API, no network, no credentials.

The conversation with the audit manager is the real one: the same graph, the same questions and the
same stops. Only the model is replaced. Replies are interpreted with simple keyword rules, and every
piece of AI output (proposals, challenge questions, the summary and its positive and negative points)
is a fixed, assumed text marked with
OFFLINE_BANNER or "(Assumed.)". The assumed texts are modelled on samples/synthetic-audit-report.md and
do not depend on the material you load.

    python scripts/run.py samples/synthetic-audit-report.md --api offline
"""

import logging
import re
from typing import Any, Dict, List, Optional

import prompts
from llm import BaseLLM, BoardSummary, Finding, GradeSuggestion, Interpretation
from prompts import StepSpec

logger = logging.getLogger(__name__)

OFFLINE_BANNER = "[OFFLINE TEST: assumed AI output, not based on your material]"

# -------------------- Rules that stand in for the model's reading of a reply --------------------

SKIP_REPLIES = {"skip", "skip this", "skip it", "none", "nothing", "n/a"}
UNKNOWN_REPLIES = {
    "",
    "no",
    "nope",
    "not yet",
    "not sure",
    "unsure",
    "no idea",
    "i don't know",
    "i do not know",
    "don't know",
    "dont know",
    "idk",
    "?",
}
# the audit manager asks for proposals, or rejects the ones on the table
UNKNOWN_PHRASES = (
    "propose",
    "suggest",
    "try again",
    "none of these",
    "none of them",
    "other option",
    "different option",
    "something else",
)
ACCEPT_REPLIES = {"yes", "ok", "okay", "fine", "agreed", "agree"}
ALL_REPLIES = {"all", "all of them", "all of these", "both"}
TONE_KEYWORDS = {
    "1": "Positive",
    "positive": "Positive",
    "2": "Balanced",
    "balanced": "Balanced",
    "3": "Neutral-professional",
    "neutral": "Neutral-professional",
    "4": "Critical",
    "critical": "Critical",
}

# -------------------- Assumed AI output --------------------
# Two rounds per step, so that rejecting the proposals shows different ones.

ASSUMED_PROPOSALS: Dict[str, List[str]] = {
    "root_cause": [
        """\
| Option | Proposed root cause |
|---|---|
| 1 | Accountability for claims data quality is divided across departments, so no one owns it end to end. |
| 2 | Data quality controls depend on manual effort and are not monitored, so lapses go unnoticed. |
| 3 | Earlier audit actions were never brought under one plan, so known weaknesses persist. |""",
        """\
| Option | Proposed root cause |
|---|---|
| 1 | Senior management receives no reporting on data quality, so the weaknesses are not escalated. |
| 2 | Roles and responsibilities for claims data were not redefined after the last system release. |""",
    ],
    "relationships": [
        """\
| No | Finding |
|---|---|
| F1 | Data quality controls over claims data are not consistently performed (High) |
| F2 | Management reporting on claims reserves contained errors (High) |
| F3 | Remediation of earlier data issues is not tracked by a single owner (Medium) |

- F1 may contribute to F2.
- F3 may explain why F1 persists.
- F1 and F3 may share the same cause.""",
        """\
| No | Finding |
|---|---|
| F1 | Data quality controls over claims data are not consistently performed (High) |
| F2 | Management reporting on claims reserves contained errors (High) |
| F3 | Remediation of earlier data issues is not tracked by a single owner (Medium) |

- F2 appears linked to F1.
- F1, F2 and F3 may all follow from the same gap in ownership.""",
    ],
    "storyline": [
        """\
### Option A: Ownership
Nobody is accountable for claims data end to end, so known weaknesses are not resolved and recur.

### Option B: Reliability of board reporting
Weaknesses in claims data have reached the figures the Executive Board relies on.

### Option C: Unfinished remediation
Issues raised two years ago remain open because remediation was never brought under one plan.""",
        """\
### Option A: Controls on paper
A sound control framework exists, but it is not operated consistently enough to be relied on.

### Option B: From data to decisions
Unresolved data exceptions flow into management reporting and weaken the basis for decisions.""",
    ],
    "positives": [
        """\
| Option | Positive aspect |
|---|---|
| 1 | A control framework for claims data is in place and documented. |
| 2 | Management was open about known weaknesses. |
| 3 | Actions have been agreed with owners and target dates. |""",
        """\
| Option | Positive aspect |
|---|---|
| 1 | Staff know the claims process well. |
| 2 | Data exceptions are logged when they are found. |""",
    ],
}

ASSUMED_GRADE = GradeSuggestion(
    grade="C",
    reason=(
        f"{OFFLINE_BANNER} Two high-risk findings on claims data remain open, so the risks are not "
        "sufficiently mitigated and short-term actions are required."
    ),
)

ASSUMED_CHALLENGE_QUESTIONS = [
    "Has management quantified the financial effect of the errors in the claims reserve report?",
    "Who will own claims data, and by when will that appointment be made?",
]

ASSUMED_SUMMARY = """\
{banner}

### Executive Board Summary

(Assumed paragraph 1, overall assessment.) A control framework for claims data is in place and \
documented, and management was open about known weaknesses. The overall audit conclusion is "Needs \
improvement". Tone applied: {tone}.{request_line}

(Assumed paragraph 2, key risks and root cause.) The summary would be built on what you confirmed:

{confirmed}

(Assumed paragraph 3, conclusion and next steps.) Management has agreed actions with owners and target \
dates. Internal Audit recommends appointing a single owner and reporting progress to the Executive \
Board each quarter.

### Potential Gaps for Executive Board Consideration

{gaps}"""

ASSUMED_POS_POINTS = [
    "(Assumed.) A control framework for claims data is in place and documented.",
    "(Assumed.) Management was open about known weaknesses.",
    "(Assumed.) Actions have been agreed with owners and target dates.",
]

# main finding -> recommendation
ASSUMED_NEG_POINTS = {
    "(Assumed.) Data quality controls over claims data are not consistently performed.": (
        "Appoint one owner for claims data quality and monitor the controls monthly."
    ),
    "(Assumed.) Management reporting on claims reserves contained errors.": (
        "Add an independent check before the report is issued."
    ),
}


def _options(proposal: str) -> Dict[str, str]:
    """The selectable options in a proposal, keyed by what the audit manager would type (1, 2, a, b)."""
    options = {
        key: text.strip()
        for key, text in re.findall(
            r"^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*$", proposal, flags=re.MULTILINE
        )
    }
    if not options:
        options = {
            key.lower(): text.strip()
            for key, text in re.findall(
                r"^### Option ([A-Z]):[^\n]*\n(.+?)(?=\n\n|\Z)",
                proposal,
                flags=re.MULTILINE | re.DOTALL,
            )
        }
    if not options:
        bullets = re.findall(r"^- (.+)$", proposal, flags=re.MULTILINE)
        options = {str(i): text.strip() for i, text in enumerate(bullets, 1)}
    return options


def _selection(reply: str, options: Dict[str, str]) -> List[str]:
    """Option keys named in a reply such as "2", "option B" or "1 and 3". Empty if it is not a selection."""
    tokens = re.sub(r"\b(options?|and|or|the|number|no\.?)\b|[,.&+/]", " ", reply.lower()).split()
    return tokens if tokens and all(t in options for t in tokens) else []


# -------------------- Provider --------------------


class OfflineLLM(BaseLLM):
    """Stands in for the model: keyword rules for the replies, fixed assumed texts for the output."""

    name = "offline test, assumed AI output"

    def interpret(
        self, question: str, reply: str, proposal: Optional[str]
    ) -> Interpretation:
        text = reply.strip()
        lowered = text.lower().rstrip(".!")
        if lowered in SKIP_REPLIES or lowered.startswith("skip"):
            return Interpretation(decision="skipped", text="")
        if lowered in UNKNOWN_REPLIES:
            return Interpretation(decision="unknown", text="")
        if any(phrase in lowered for phrase in UNKNOWN_PHRASES):
            return Interpretation(decision="unknown", text=text)

        if not proposal:
            # "yes" to "do you already have one in mind?" gives nothing to use
            if lowered in ACCEPT_REPLIES:
                return Interpretation(decision="unknown", text="")
            return Interpretation(decision="confirmed", text=text)

        options = _options(proposal)
        if lowered in ALL_REPLIES:
            chosen = list(options)
        elif lowered in ACCEPT_REPLIES:
            chosen = list(options)[:1]
        else:
            chosen = _selection(lowered, options)
        if chosen:
            return Interpretation(
                decision="confirmed",
                text=" ".join(options[key] for key in chosen),
            )
        # anything else is the audit manager's own refinement or alternative
        return Interpretation(decision="confirmed", text=text)

    def interpret_tone(self, reply: str) -> str:
        lowered = reply.lower()
        for keyword, tone in TONE_KEYWORDS.items():
            if re.search(rf"\b{keyword}\b", lowered):
                return tone
        return prompts.DEFAULT_TONE

    def propose(
        self,
        step: StepSpec,
        material: List[Dict[str, Any]],
        confirmed: str,
        guidance: str,
        previous: Optional[str],
    ) -> str:
        rounds = ASSUMED_PROPOSALS[step.key]
        # show the round that is not on the table already
        options = next(
            (r for r in rounds if not previous or r not in previous), rounds[0]
        )
        note = (
            f"\n(Your direction was received but is not applied offline: {guidance})"
            if guidance
            else ""
        )
        return f"{OFFLINE_BANNER}{note}\n\n{options}"

    def refine_storyline(
        self, storyline: str, material: List[Dict[str, Any]], confirmed: str
    ) -> str:
        logger.info("(offline: your storyline is kept as you wrote it)")
        return storyline

    def suggest_grade(self, material: List[Dict[str, Any]]) -> GradeSuggestion:
        return ASSUMED_GRADE

    def challenge(
        self, material: List[Dict[str, Any]], confirmed: str
    ) -> List[str]:
        return [f"(Assumed.) {q}" for q in ASSUMED_CHALLENGE_QUESTIONS]

    def write_summary(
        self,
        material: List[Dict[str, Any]],
        confirmed: str,
        tone: str,
        request: str,
        challenge_questions: List[str],
        challenge_answers: str,
    ) -> BoardSummary:
        answered = challenge_answers and challenge_answers.lower() != "proceed"
        if answered:
            gaps = (
                "- (Assumed.) Your answer to the challenge review would be reflected here: "
                f"{challenge_answers}"
            )
        else:
            gaps = "\n".join(f"- {q}" for q in ASSUMED_CHALLENGE_QUESTIONS)
        summary = ASSUMED_SUMMARY.format(
            banner=OFFLINE_BANNER,
            tone=tone,
            request_line=f" Your request: {request}." if request else "",
            confirmed=confirmed,
            gaps=gaps,
        )
        return BoardSummary(exe_summary=summary, pos_points=ASSUMED_POS_POINTS)

    def summarise_findings(self, material: List[Dict[str, Any]]) -> List[Finding]:
        return [
            Finding(finding=finding, recommendation=recommendation)
            for finding, recommendation in ASSUMED_NEG_POINTS.items()
        ]
