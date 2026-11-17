# Executive Summary Writer

An assistant that helps an internal audit manager turn a finished audit report
into a short summary for an Executive Board.

## What it is for

Board members want a brief, business-level message: what is going on, why it
matters, and what is being done about it. An audit report is written the other
way round, as a list of detailed findings. Bridging the two is manual work that
depends on the judgement of the audit manager.

The Executive Summary Writer supports that work. It reads the audit report,
talks the main points through with the audit manager, and then drafts the
summary and completes the summary page of the report.

## How it works, in outline

- **The audit manager stays in charge.** The agent asks questions to
  facilitate writing the summary before it drafts anything.
- **A language model does the drafting.** It proposes options where the audit
  manager wants suggestions and writes the text once the message is agreed.
- **Facts come from the report.** Figures and labels that the report already
  states are taken from it directly rather than generated.
- **The result is reviewed by a person.** Everything the assistant produces is a
  draft for the audit manager to check and edit.

It can be used from the command line or through a web interface.

## Model & data residency

- **Claude (default):** the audit material and the conversation are sent to
  Anthropic's API under your own `ANTHROPIC_API_KEY`. A request declined by a
  safety classifier may be re-run on a fallback model.
- **OpenAI:** the same data goes to the OpenAI or Azure OpenAI deployment
  configured locally.
- **Offline test:** nothing leaves the machine.
- The web interface sends the uploaded report to the agent service, which
  calls the configured model the same way.

## Limitations & human-review gate

The summary is a draft for the audit manager to review and edit before it
goes to the Executive Board; it is not a final audit communication. See
`AUDIT-CRITERIA.md` section 5 for the known limits.

## Guardrails

The agent runs no prohibited command. The only subprocess it starts is a
LibreOffice conversion, used for legacy `.doc`, `.xls` and `.ppt` input.

## Data

No real audit material is included. The sample in `samples/` is invented.

## Authors and rights

- Agent and workflow: Junhan Wen
- Web interface: Thomas Nguyen

Built in October 2026. No licence is granted for the contents of this
repository or its history: all rights remain with the authors. Please contact
the authors before reusing any part of it.
