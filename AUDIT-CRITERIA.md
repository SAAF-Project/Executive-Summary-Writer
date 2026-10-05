# AUDIT-CRITERIA.md — Executive-Summary-Writer

> What this agent must be judged against as an auditee: its control objectives, testable acceptance criteria, and known limits. The [README](README.md) says what the agent does and how to run it. This document follows the SAAF A2 standard (`docs/conventions/audit-criteria-template.md` in the main SAAF-Project repo).

---

## Metadata

| Field | Value |
|---|---|
| **Agent** | Executive-Summary-Writer |
| **Repository** | https://github.com/SAAF-Project/Executive-Summary-Writer |
| **Maintainer(s)** | Junhan Wen |
| **Last reviewed** | 2026-10-05 |
| **Status** | Draft |

**Sources used to draft this document:** the README, the code in `scripts/`, the tests in `tests/test_graph.py`, and the plan `plans/hackathon-4/junhan-wen-executive-summary-writer.md` in the main SAAF-Project repo. Not yet reviewed by a second person.

**This agent makes model calls at runtime** (Claude interprets the audit manager's replies, proposes options, runs the challenge review and writes the summary), so AI-specific frameworks apply.

## 1. What the agent does

The agent helps an audit manager turn audit material (a draft report, observations, management responses) into a three-paragraph Executive Board summary. It does not summarise straight away. It first takes the audit manager through a preparation phase (common root cause, relationships between findings, storyline, tone), then reviews the material for gaps from the perspective of the Board, the regulator, the external auditor and the CRO, and only then writes the summary with a list of remaining gaps. The output is a Markdown draft for the audit manager to review and edit.

## 2. Control objectives & framework mapping

These are control objectives **for the agent itself**: what must be true of its behaviour for an audit manager to rely on it. They are not the objectives of the audit whose report is being summarised.

| Control objective | Framework + clause/area | Why relevant |
|---|---|---|
| CO-1 — The preparation phase cannot be bypassed: no summary, and no draft of one, is produced until root cause, relationships, storyline and tone have each been confirmed or explicitly skipped by the audit manager. | EU AI Act Art. 14 (human oversight) | The agent exists because a model that summarises immediately produces a finding-by-finding list. The human decisions must come first. |
| CO-2 — The audit manager owns the narrative: the agent asks before it proposes, proposes a small number of options, and stops for a decision after proposing. | IIA Global Internal Audit Standards 11.2 (Effective Communication: accurate, objective) and 14.5 (Engagement Conclusions) | The key message of a board summary is a professional judgement. The agent may suggest it; it must not decide it. |
| CO-3 — Nothing is invented and proposals are not presented as facts: the summary uses only the audit material and what the audit manager confirmed, and remaining gaps are listed. | IIA Global Internal Audit Standards 14.3 (Evaluation of Findings) and EU AI Act Art. 13 (transparency) | A plausible but unsupported root cause or causal link in a board paper is the main harm this agent could do. |
| CO-4 — The output is fit for the Board: short, in business language, limited to the risks that matter at board level, in the agreed structure. | IIA Global Internal Audit Standards 11.3 (Communicating Results) and 15.1 (Final Engagement Communication) | A summary that is long, technical or lists every low-risk finding fails its purpose even if every fact is right. |
| CO-5 — Credentials and audit material are protected: no secrets in code, and no real audit material or generated summaries in the repository. | ISO/IEC 27001 Annex A (access control and protection of information) | Draft audit reports are confidential. |

## 3. Acceptance criteria (testable, pass/fail)

### CO-1 — The preparation phase cannot be bypassed

- Given audit material and any request, the agent's first response is the introduction and the Step 1 question only, and no model call has been made before it.
- Given replies such as "Please provide a summary", "Summarise in 600 words" or "Write the summary now" in place of answers, the agent does not write a summary; it continues with the next preparation question.
- Given a run in which any of root cause, relationships or storyline is neither confirmed nor skipped, or no tone is set, the summary step raises an error and no summary is written.
- Given a request passed with `--request`, its format preferences are applied only when the final summary is written.

### CO-2 — The audit manager owns the narrative

- Given an audit manager who states a root cause, relationships or a storyline, the agent records that answer and does not call the model for proposals on that step.
- Given an audit manager who does not know, the agent proposes options (at most three root causes; key findings F1, F2, … with possible relationships; two to three storylines) and then stops until the audit manager replies.
- Given an audit manager who rejects the proposals, the agent proposes again and stops again; it does not pick an option itself.
- Given an answer to a step, the next question starts by repeating what was recorded for that step.
- Given an empty reply to the tone question, the tone is Balanced, without a model call.
- Given a storyline selected from the agent's proposals, the agent uses it as selected. Given a storyline supplied by the audit manager, the agent tightens it into one or two sentences.
- **Limitation, stated honestly:** the audit manager's reply is classified by the model as an answer, "don't know" or "skip". A misclassification is visible in the acknowledgement at the next question, but the audit manager cannot go back a step to correct it within the same run.

### CO-3 — Nothing invented, proposals are not facts

- Given proposed relationships between findings, the wording is cautious ("may contribute to", "appears linked to") and not stated as established.
- Given a summary, every figure, owner, date and management action in it can be found in the audit material or in the audit manager's replies.
- Given a relationship that was proposed but not confirmed, the summary does not state it as a fact.
- Given a step the audit manager skipped, the summary presents the corresponding point as Internal Audit's view, not as an established fact.
- Given critical gaps identified in the challenge review, the audit manager is asked about them before the summary is written, and any question left unanswered appears under "Potential Gaps for Executive Board Consideration".
- **Limitation, stated honestly:** the second, third and fourth criteria depend on model behaviour and are checked by a person comparing the summary with the material. Nothing in the code verifies them.

### CO-4 — Fit for the Board

- Given a completed run, the output contains a confirmation of at most four bullets (root cause, key finding relationships, storyline, tone), a summary of three paragraphs, and a section "Potential Gaps for Executive Board Consideration".
- Given material with low-risk findings, the summary does not discuss them.
- Given any material, the summary is in UK English and does not use control or test identifiers or system names that a Board member would not know.

### CO-5 — Credentials and material protection

- Given the repository, no file contains an API key or other credential; the key is read from `ANTHROPIC_API_KEY`.
- Given the repository, `output/` and `data/` are git-ignored, and the only audit material tracked is the synthetic sample in `samples/`.

## 4. Good output / never do

| A correct output MUST contain | The agent must NEVER |
|---|---|
| ✓ The confirmation of root cause, relationships, storyline and tone, showing which were skipped | ✕ Write a summary, or a draft of one, before the preparation phase is complete |
| ✓ Three paragraphs: overall assessment; key risks and root cause; conclusion and next steps | ✕ Invent facts, figures, owners, root causes or causal links |
| ✓ The confirmed root cause and storyline as the backbone of the text | ✕ State a proposed but unconfirmed relationship as a fact |
| ✓ A "Potential Gaps for Executive Board Consideration" section | ✕ Choose the root cause, storyline or tone on the audit manager's behalf (other than the stated default tone) |
| ✓ Plain business UK English | ✕ Present the summary as final without the audit manager's review |
| | ✕ Hard-code credentials, or commit real audit material or generated summaries |

The output is narrative text, not findings, so `outputs/schemas/finding-schema.json` does not apply to it.

## 5. Coverage gaps

- **Not yet run against the live Claude API.** The conversation flow is tested with a scripted stand-in for the model. Every criterion that depends on what the model writes is unverified.
- **No evaluation of summary quality.** There is no set of reports with reference summaries, and no measure of whether the summary is faithful to the material.
- **No fact-check of the summary against the material.** Invented or altered facts would have to be caught by the audit manager.
- **No way to go back a step** or to correct a misinterpreted reply without restarting.
- **The conversation is held in memory.** A stopped run cannot be resumed, and there is no record of the conversation other than the final file.
- **No transcript or prompt log.** The prompts sent to the model and its raw replies are not saved, so a summary cannot be traced back to the calls that produced it.
- **Confidentiality depends on where it is run.** The audit material is sent to the Anthropic API; whether that is permitted for a given report is the user's decision and is not checked.
- **Fallback model.** By default, a request declined by a safety classifier is re-run on a fallback model, and the output does not say which model answered.
- **Only the complete-instruction design is implemented.** The instruction-with-skills design, with a separate theme-synthesis step, is not.
- **`.docx` and `.pdf` input are untested.**

## 6. Status / validation

| Acceptance criterion | Verified? | Evidence |
|---|---|---|
| CO-1 — first response is the Step 1 question only, with no model call | ☑ | `tests/test_graph.py::test_first_response_only_asks_step_1` |
| CO-1 — "write the summary" replies do not produce a summary | ☑ | `test_summary_is_never_written_before_all_steps_are_done` |
| CO-1 — summary step refuses to run with open steps | ☐ | Guard exists in `scripts/graph.py` (`write_summary`); no test reaches it because the graph has no path that skips a step |
| CO-1 — `--request` is applied only at the end | ☑ | `test_confirmation_has_at_most_four_bullets_and_request_is_passed_on` |
| CO-2 — no proposals when the audit manager knows the answer | ☑ | `test_user_knows_everything_goes_straight_through` |
| CO-2 — proposals are followed by a stop; rejected proposals are proposed again | ☑ | `test_unknown_root_cause_gets_proposals_and_stops_for_a_choice`, `test_rejected_proposals_are_proposed_again` |
| CO-2 — skipped steps, default tone, storyline handling | ☑ | `test_skipped_steps_and_default_tone`, `test_storyline_chosen_from_proposals_is_not_refined` |
| CO-2 — the model classifies real replies correctly | ☐ | Needs a live run with varied replies |
| CO-3 — challenge questions are asked before the summary and passed to it | ☑ | `test_challenge_questions_are_asked_before_the_summary` |
| CO-3 — no invented facts; unconfirmed relationships not stated as facts | ☐ | Needs a live run on the synthetic sample and a line-by-line comparison |
| CO-4 — confirmation of at most four bullets | ☑ | `test_confirmation_has_at_most_four_bullets_and_request_is_passed_on` |
| CO-4 — three paragraphs, gaps section, no low-risk findings, UK English | ☐ | Needs a live run |
| CO-5 — no credentials or real material in the repository | ☑ | Tracked files reviewed on 2026-10-05 |

All ☑ rows above are verified with the scripted stand-in for the model, not with Claude. Next step: a live run on `samples/synthetic-audit-report.md` (which contains a low-risk finding and an unquantified impact on purpose) to check the open CO-3 and CO-4 rows.

## 7. Observability

Logged today: progress messages for each model-backed step, and with `--verbose` the token usage per call, including prompt-cache reads. The final summary is saved with the confirmed root cause, relationships, storyline and tone at the top. Missing: no transcript of the conversation, no log of prompts and raw replies, no record of which model answered when a fallback occurred, and no cost accounting.
