"""Prompt texts for the Executive Summary Writer.

The step-by-step process is enforced by the graph (graph.py), so there is no
single long instruction: there is one shared system prompt and one short task
per step.

These are generic texts. To use your own organisation's wording, create
scripts/prompts_local.py and redefine any of the names below
there; it is loaded at the end of this file.
"""

from dataclasses import dataclass

# -------------------- Shared system prompt --------------------
# Frozen: it is part of the cached prefix.

SYSTEM_PROMPT = """\
You are a senior internal audit leader who writes for the Executive Board.

Board members want a short, strategic, business-level message, not a list of \
audit observations. A good board summary of an audit explains what is going \
on, why it is happening, why it matters to the organisation, and what \
management is doing about it. It draws out the underlying cause and the links \
between findings instead of repeating each finding.

You are supporting an audit manager. Before any summary is written, the audit \
manager is taken through a preparation phase: the common root cause, how the \
findings relate to each other, the storyline, the tone, and a challenge \
review. The application controls this sequence and sends you one request at a \
time. Answer only the request in front of you. Do not anticipate later steps, \
and do not produce a summary or any draft of one until a request explicitly \
asks for the final Executive Board summary.

In everything you write:
- use plain business UK English and avoid audit or technical jargon;
- stay factual, objective and concise;
- use only the audit material and what the audit manager has confirmed. Do \
not invent facts, causes or causal links.
"""

# -------------------- First response and step questions --------------------

INTRO = (
    "Before I write the Executive Board summary, I would like to check a few "
    "points with you so that the summary carries the right message. This "
    "takes a few short steps."
)


@dataclass(frozen=True)
class StepSpec:
    # state key that holds the confirmed result
    key: str
    # label used in acknowledgements and in the pre-summary confirmation
    label: str
    # asked first: the audit manager may already know the answer
    question: str
    # task for Claude when the audit manager does not know
    propose: str
    # question that follows Claude's proposals
    closing: str
    # strengthen an answer the audit manager supplied (storyline only)
    refine: bool = False


ROOT_CAUSE = StepSpec(
    key="root_cause",
    label="Root cause",
    question=(
        "Step 1 of 6: Is there a common root cause behind the main findings "
        "that you already have in mind?"
    ),
    propose="""\
The audit manager has no root cause in mind yet.

From the audit material, suggest up to three candidate root causes that could \
explain the main findings together. One sentence each. Return a Markdown \
table with the columns "Option" (1, 2, 3) and "Proposed root cause", and \
nothing else.

Stay on root causes: no relationships between findings, no storyline, no \
tone.""",
    closing="Would you like to pick one of these, adjust one, or give your own?",
)

RELATIONSHIPS = StepSpec(
    key="relationships",
    label="Key finding relationships",
    question=(
        "Step 2 of 6: Should the summary bring out any relationships between "
        "findings, such as one finding leading to another?"
    ),
    propose="""\
The audit manager is not sure which relationships between findings to bring \
out.

Start with a Markdown table of the key findings, with the columns "No" (F1, \
F2, F3, ...) and "Finding". Include the high-risk findings and the \
medium-risk findings that matter at board level; leave out the rest.

Below the table, suggest possible relationships as short bullets. These are \
suggestions, so word them cautiously ("may contribute to", "may explain", \
"appears linked to"), for example:
- F2 appears linked to F1.
- F1 and F3 may share the same cause.

Return the table and the bullets, and nothing else. No storyline, no tone.""",
    closing="Which of these relationships, if any, should the summary reflect?",
)

STORYLINE = StepSpec(
    key="storyline",
    label="Storyline",
    question=(
        "Step 3 of 6: Do you already have a storyline, or a key message for "
        "the Executive Board, in mind?"
    ),
    propose="""\
The audit manager has no storyline in mind yet.

Suggest two or three alternative storylines. Each one gets a heading "### \
Option A: <theme>" (then B, C) and one or two sentences that state the \
message the Board should take away, for example:

### Option A: Ownership
Nobody is accountable end to end, so known weaknesses are not resolved and \
recur.

Build the options on the audit material and on what has been confirmed so \
far. Return the options and nothing else. No tone.""",
    closing="Which storyline would you like to use?",
    refine=True,
)

POSITIVES = StepSpec(
    key="positives",
    label="Positive aspects",
    question=(
        "Step 4 of 6: What do you see as the positive aspects of the audited "
        'area? They go in the "Positive aspects" box of the report.'
    ),
    propose="""\
The audit manager has not named the positive aspects yet.

From the audit material, suggest up to five things that work well in the \
audited area. One short sentence each. Return a Markdown table with the \
columns "Option" (1, 2, 3, ...) and "Positive aspect", and nothing else.

Stay on what works well: no findings, no recommendations, no tone.""",
    closing=(
        "Which of these should the report show? You can pick several, adjust "
        "them, or give your own."
    ),
)

STEPS = (ROOT_CAUSE, RELATIONSHIPS, STORYLINE, POSITIVES)

# -------------------- Step 5: overall grade --------------------
# The model suggests a grade and the audit manager chooses. The grading table
# and the question are fixed texts: in a user interface the choice becomes a
# drop-down menu.

GRADES = {
    "A": "Risks identified in the audited process are well mitigated. Limited actions might be required.",
    "B": "Risks identified in the audited process are adequately mitigated but actions are required on weaker aspects.",
    "C": "Risks identified in the audited process are not sufficiently mitigated (one or more). Short-term actions are required.",
    "D": "Risks identified in the audited process are not mitigated (one or more). Immediate actions are required.",
}
GRADE_TABLE = "\n".join(f"{grade}. {text}" for grade, text in GRADES.items())

SUGGEST_GRADE = f"""\
Suggest the overall grade of the audited process.

Base it on all the findings in the audit material. In a report deck, each \
finding is a block that starts with "Finding title:" and has the lines \
"Risk" (High, Medium or Low), "Finding", "Root Cause(s)", "Risk(s)", \
"Stake(s)" and "Recommendation". Weigh how many findings there are, how high \
their risk is, and how urgent the recommended actions are.

Grading table:
{GRADE_TABLE}

Return the "grade" (A, B, C or D) and the "reason": one or two sentences \
that name the findings the grade rests on. Use only what the audit material \
says."""

GRADE_QUESTION = (
    "Step 5 of 6: Overall grade. Based on the findings listed in the report, "
    "I would suggest the overall grade {grade}: {definition}\n\n"
    "{reason}\n\n"
    "What do you think?\n\n"
    f"{GRADE_TABLE}\n\n"
    "Press Enter to accept {grade}, or reply A, B, C or D."
)
GRADE_RETRY = "Please reply A, B, C or D, or press Enter to accept the suggestion."
# replies that accept the suggested grade
GRADE_ACCEPT = ("", "YES", "Y", "OK", "OKAY", "AGREE", "AGREED")

TONES = ("Positive", "Balanced", "Neutral-professional", "Critical")
DEFAULT_TONE = "Balanced"

TONE_QUESTION = (
    "Step 6 of 6: Which tone should the summary have?\n\n"
    "1. Positive\n2. Balanced\n3. Neutral-professional\n4. Critical\n\n"
    "Press Enter for the default (Balanced)."
)

BALANCED_DEFINITION = """\
What "Balanced" means here:
- open with what works well;
- describe the findings as facts, without emphasis;
- state the risks in neutral terms;
- keep the conclusion objective and professional."""

# ---------- Tasks that interpret the audit manager's replies ----------

INTERPRET_REPLY = """\
You are interpreting an audit manager's reply during the preparation of an \
Executive Board summary.

Question that was asked:
{question}

{proposal_block}Audit manager's reply:
{reply}

Classify the reply:
- "confirmed": the audit manager gave their own answer, or selected, combined \
or refined one of the proposed options, or provided an alternative. Set \
"text" to the resulting statement. Use the audit manager's wording and the \
wording of the option(s) they chose. Do not add anything they did not say or \
choose.
- "unknown": the audit manager does not know, asks for proposals, or rejects \
the proposed options and wants different ones. A bare "no" to a question of \
the form "Is there ... you already have in mind?" or "Do you already have \
...?" means unknown. Set "text" to any direction they gave for new proposals, \
otherwise to an empty string.
- "skipped": the audit manager explicitly wants to skip this item, or says \
there is nothing to bring out. Set "text" to an empty string."""

INTERPRET_TONE = """\
An audit manager was asked which tone an Executive Board summary should have. \
The options are: 1. Positive, 2. Balanced, 3. Neutral-professional, 4. \
Critical. The default is Balanced.

Audit manager's reply:
{reply}

Return the tone they chose. If the reply does not clearly choose one of the \
four options, return Balanced."""

REFINE_STORYLINE = """\
The audit manager wants the Executive Board summary to follow this storyline \
or key message:

{storyline}

Tighten it into one or two sentences that the whole summary can be built \
around. Keep the audit manager's message and intent. Do not add facts that \
are not in the audit material or in what has been confirmed so far. Return \
the storyline and nothing else."""

# -------------------- Report header --------------------
# Two values for the header of the executive summary slide. Fixed questions and
# fixed answers, read without the model: in a user interface each one is a
# drop-down menu.

DOMAINS = ("Finance", "HR", "Corporate", "Other")
DOMAIN_QUESTION = (
    "Report header: which domain does the audit belong to?\n\n"
    "1. Finance\n2. HR\n3. Corporate\n4. Other (you type the domain)"
)
DOMAIN_OTHER = "Please type the domain."

PROCESS_RISKS = ("Minor", "Moderate", "Material", "Major")
PROCESS_RISK_QUESTION = (
    "Report header: what is the process risk (gross)?\n\n"
    "1. Minor\n2. Moderate\n3. Material\n4. Major"
)
PROCESS_RISK_RETRY = "Please reply Minor, Moderate, Material or Major."

# -------------------- Challenge review --------------------
# Optional: the audit manager is asked first. The offer, its two options and
# the reading of the reply are fixed texts: in a user interface the choice is a
# selection menu.

CHALLENGE_OFFER = (
    "Would you like a challenge review before I write the summary?\n\n"
    "It is a quick check, in at most three short questions, of what a Board "
    "member, the regulator, the external auditor or the Chief Risk Officer "
    "might still ask.\n\n"
    "Reply Yes or No."
)
CHALLENGE_OPTIONS = ("Yes", "No")
CHALLENGE_RETRY = "Please reply Yes or No."
# replies that accept or decline the challenge review; no reply declines it
CHALLENGE_YES = ("YES", "Y", "1")
CHALLENGE_NO = ("NO", "N", "2", "")
MAX_CHALLENGE_QUESTIONS = 3
CHALLENGE_QUESTIONS = (
    "Challenge review. Before I write the summary:\n\n{questions}\n\n"
    "Answer what you can, or reply 'proceed' to continue without."
)


CHALLENGE_REVIEW = """\
Root cause, relationships, storyline, positive aspects, overall grade and \
tone are settled.

Now read the available information the way each of these readers would:
- an Executive Board member
- the regulator
- the external auditor
- the Chief Risk Officer

Look for information that one of them would need and that is missing: for \
instance the business or financial impact, who owns the issue, how and when \
it will be remediated, regulatory consequences, whether the issue has \
occurred before, or management's own position.

Return the questions you would put to the audit manager: three at most, the \
most important first. Include a question only when the answer matters for a \
board-level summary and cannot be found in the audit material or in what has \
been confirmed. If nothing important is missing, return an empty list.

Keep it light. Each question is one short sentence of at most 20 words, in \
plain words, about one thing only. No introduction, no explanation of why you \
ask, and no naming of the reader who would ask it."""

# -------------------- Final summary --------------------

WRITE_SUMMARY = """\
The preparation phase is complete. Write the final Executive Board summary now.

{request_block}Confirmed with the audit manager:
{confirmed}

{tone_block}{challenge_block}Rules:
- Cover the high-risk findings and the medium-risk findings that matter at \
board level. Leave out the rest.
- Keep it short.
- Say what the findings mean for the business.
- Explain the root cause.
- Explain how the findings relate. Only the relationships confirmed above may \
be stated as facts.
- Build the summary around the confirmed storyline.
- Give the confirmed overall grade and what it means as the overall audit \
conclusion.
- Where an item above was skipped, rely on what the audit material supports \
and present it as Internal Audit's view, not as an established fact.
- No jargon, business UK English, factual and objective.
- Do not invent facts.

Structure:

### Executive Board Summary

Paragraph 1, overall assessment: what works well, and the overall audit \
conclusion.

Paragraph 2, key risks and root cause: the most significant observations, the \
common root cause, the business impact and the wider implications.

Paragraph 3, conclusion and next steps: what management will do, what \
Internal Audit recommends, the improvement to expect, and the takeaway for \
the Executive Board.

Write these as three plain paragraphs without paragraph headings.

Then add a separate section:

### Potential Gaps for Executive Board Consideration

A bullet list of the important questions that the available information \
leaves unanswered."""

# Added to WRITE_SUMMARY: the summary is returned together with the points for
# the "Positive aspects" box of the report.
SUMMARY_FIELDS = """\
Return two fields.

"exe_summary": the complete text described above as Markdown, with both \
headings.

"pos_points": the positive aspects for the report, as two to five short \
sentences, one per point, for example "Payment is well controlled." Use the \
positive aspects confirmed above. Where that item was skipped, take them \
from the audit material."""

# -------------------- Main findings table --------------------
# One direct call, without questions to the audit manager: the findings and
# their recommendations are in the audit material already.

SUMMARISE_FINDINGS = """\
Fill the "Main findings" table of the report: one line per finding, with a \
quick summary of the finding and of its recommendation.

Take the findings from the audit material. In a report deck, each finding is \
a block that starts with "Finding title:" and has the lines "Finding", "Root \
Cause(s)", "Risk(s)", "Stake(s)" and "Recommendation".

Include the high-risk findings, or the main medium-risk findings where there \
are no high-risk ones. Four at most, in the order of the report.

For each one return:
- "finding": one short sentence that says what is wrong, for example \
"Payment is not well controlled."
- "recommendation": one short sentence that sums up the recommendation given \
for this finding, for example "The team should have a gateway." Where the \
material gives no recommendation for a finding, suggest one that follows \
from its root cause.

Use only what the audit material says about each finding. Do not mention \
that the text was written or suggested by AI: the application adds that \
note. If the material holds no findings, return an empty list."""

# -------------------- Local wording (optional, not published) --------------------

try:
    from prompts_local import *  # noqa: F401,F403,E402
except ImportError:
    pass
