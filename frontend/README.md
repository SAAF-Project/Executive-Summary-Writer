# ESWriter

A local hackathon demo for completing an audit PowerPoint’s executive summary. Upload the report, discuss it with the real Executive Summary Writer agent, review the whole presentation, edit the summary and A–D process grade, then download an editable `.pptx` copy.

## Run the connected demo

Requires Node.js 22+, Python 3.10+, and an Anthropic API key.

```sh
npm ci
npm run demo
```

The launcher prepares the Python environment on first run and starts the frontend at **http://127.0.0.1:3000** and the agent at **http://127.0.0.1:8000**. Ctrl+C stops both. Do not separately start another frontend on port 3000.

1. Upload the completed `.pptx` audit report, up to 25 MB / 100 slides.
2. Connect Claude in the local key form. The key is validated and retained only in the local server’s memory, never browser storage or exports. Alternatively copy `agent-service/.env.example` to `agent-service/.env` and enter the key there. The file is ignored and excluded from source archives.
3. The agent reads the deck, summarizes its evidence, and asks a tailored first question. No template-field setup or copied audit notes are required.
4. Answer the latest upstream workflow’s questions: root causes, relationships, storyline, positive aspects, an agent-proposed A–D grade, tone, and challenge review. If evidence cannot support a grade, it leaves the recommendation unset and asks for the missing information before continuing. Supporting slide references are checked against the uploaded deck. The agent writes the board summary and finding recommendations.
5. Review every slide. Summary cells are editable in the presentation preview and inspector. Click the large grade square to open the A–D dropdown. The original agent recommendation remains visible when you change it.
6. Save the reviewed presentation and download PowerPoint. The selected grade color and its exact definition are included in the summary slide. Other source slide parts, media, masters and layouts remain unchanged.

The uploaded anonymized deck was inspected as Open XML and rendered locally. It has 13 slides. The primary Executive Summary is slide 4: Audit conclusion, Positive aspects, Main findings/recommendations/owners, and a colored grade square. Its separate **Process risk (gross)** field is not the A–D mitigation grade and is retained. The second Executive Summary slide’s closing text stays as uploaded. The supplied file still includes template placeholders: those are missing evidence, not completed audit facts. Upload a completed report for a meaningful live run. The source deck and its images/names are not bundled or deployed.

## Current agent commit

Unmodified agent modules are pinned to [`cd950925efacd756c6d9da5a10ce7b502b3b0ac3`](https://github.com/SAAF-Project/Executive-Summary-Writer/commit/cd950925efacd756c6d9da5a10ce7b502b3b0ac3), checked 6 October 2026. This update adds positive aspects, the grade recommendation/confirmation, structured summary output and PowerPoint-writing support.

ESWriter uses its actual `build_graph`, Claude provider, prompts, labelled finding material extraction and output-format helpers. The local HTTP wrapper adds presentation reading before the interview, background jobs, polling, revision/idempotency protection, and final review. The presentation provider extends the upstream grading response with checked slide references and an insufficient-evidence clarification path, then uses the original A–D confirmation step. It does not duplicate the upstream grading/summary workflow or expose its offline test provider. Human-reviewed edits are patched into the original Open XML summary objects. Unlike the upstream CLI’s broad deck writer, ESWriter retains already-filled sections and updates the requested summary/grade areas.

Set `AGENT_REPOSITORY_PATH=/absolute/path/to/Executive-Summary-Writer` before launching to use a compatible working checkout instead of the pinned snapshot. Restart after agent changes. See `agent-service/UPSTREAM.md`. Model settings can be overridden in the local `.env`; defaults follow the reviewed agent.

## What is stored and sent

The original deck’s byte array, extracted metadata, conversation snapshots, and reviewed summary edits are kept in IndexedDB in this browser. The app copies the uploaded bytes before clearing the file picker, avoiding stale disk-backed browser File references. Download links stay attached and valid while the browser starts the transfer. Re-uploading the identical source repairs older unreadable File/Blob records while keeping saved summary edits. Re-uploading the same source uses its SHA-256 identity. The Templates tab has been replaced with Previous audits. Uploaded reports, conversation snapshots and reviewed summaries are listed with their status, selected grade and last-updated date. Saved summaries can be reopened for local editing and export even after the agent process restarts. Unfinished conversations still need their live agent checkpoint.

The browser uploads the report to the loopback Python service when analysis starts. Readable text, native table content, speaker notes and chat replies are passed to Claude. Images/charts stay in the deck but are not visually analyzed. Do not infer that an image-only audit finding has been read. Preview can differ in fonts, charts, gradients, transforms, cropping and complex formatting; use the exported PowerPoint for final checks.

Agent conversations use one local Python process with in-memory checkpoints, up to 30 sessions and two-hour idle expiry. Navigation/reload restores an active conversation while that process lives; browser review edits are retained. Restarting the process clears chat checkpoints and in-memory API credentials. Download the reviewed report before restarting. The demo has no shared database, authentication or multi-user isolation.

Text budgets prevent obvious overflow before approval. Long outputs remain editable and visibly require shortening rather than being silently truncated. If the agent supplies more findings than available summary rows, a warning asks the user to select/edit what to include. Original finding slides remain intact. Finding owners are preserved for human review; no owners are invented. Potential Gaps stays in the conversation artifact and is excluded from the slide body using the upstream formatter.

## Development and validation

```sh
npm run typecheck
npm run lint
npm run build
npm test
agent-service/.venv/bin/python -m pip install -r agent-service/requirements-dev.txt
agent-service/.venv/bin/python -m pytest agent-service/tests -q
```

Playwright uses Chromium; use `PLAYWRIGHT_CHANNEL=chrome npm test` for installed Chrome. Tests cover upload limits, source order, the presentation interview/review boundary, grade changes, Previous audits, persistence (including rejected browser writes with PowerPoint recovery), offline saved-review editing, stale-source recovery, and real PPTX export after removal of the original disk file. Backend tests exercise the latest graph using explicit deterministic providers, never live model responses. Optional local `REPORT_PPTX=/absolute/path/to/report.pptx` checks the supplied deck and verifies all unrelated package parts are byte-for-byte unchanged. `REFERENCE_PPTX` is no longer needed for the removed Templates interface. No private fixture is included in source archives.

Live Claude generation and audit-output quality remain unverified until a real key is connected. The runnable app contains no fabricated analysis or demo grade.

## Structure

```text
src/components/report-assistant.tsx   Upload, connection, analysis and real agent chat
src/components/report-deck-review.tsx Whole presentation, in-slide edits, grade and export
src/components/slide-preview.tsx      Approximate source preview and native editors
src/components/eswriter.tsx           Shared shell and searchable Previous audits
src/lib/pptx.ts                       Guarded browser Open XML extraction
src/lib/report.ts                     Summary/grade bindings and original-package export
src/lib/storage.ts                    Browser source and review persistence
src/lib/agent-contract.ts             Typed local HTTP conversation contract
src/app/api/agent/[...path]/route.ts   Same-origin Next.js → local Python proxy
agent-service/app.py                  Jobs, revisions, model connection and review
agent-service/presentation.py         Deck evidence and initial reading/output adapter
agent-service/upstream/               Unmodified latest pinned graph/provider/helpers
scripts/dev-demo.mjs                  One-command local launcher
```

## Vercel

The [deployed frontend](https://audit-template-studio.vercel.app) can be imported as a standard Next.js project. When this project is inside Executive-Summary-Writer, use `frontend` as Root Directory; for the standalone source archive use this folder. Use a Node version of at least 22, `npm run build`, and the default Output Directory. No key is required for the upload/preview tools.

The connected hackathon demo runs locally. Vercel cannot reach your laptop’s localhost, and the Python service is excluded from frontend deployment. Use `npm run demo` and http://127.0.0.1:3000 for real conversations. `AGENT_API_URL` and optional `AGENT_API_TOKEN` provide the server-side boundary for a future hosted agent. A hosted service needs its own upload limits, session storage and access controls.


## Let someone use the full flow through Vercel

Vercel hosts the Next.js frontend. The Python graph needs a reachable, long-running agent service; it cannot use your laptop's localhost from Vercel. The included service uses in-memory jobs/checkpoints, so run one instance with one worker for this hackathon. This is a demo deployment, not durable shared audit storage.

1. Publish this folder as `frontend/` in the agent repository. In Vercel, import that repository, select branch `main` and set Root Directory to `frontend`.
2. Deploy `frontend/agent-service` as a Docker web service, for example on [Render](https://render.com/docs/docker). Use its Dockerfile with the service directory as build context, and one instance. The container binds `0.0.0.0` and the platform's `PORT`.
3. In the agent host's environment settings, enter `ANTHROPIC_API_KEY` and a random `AGENT_API_TOKEN` (at least 32 random bytes). The Docker service refuses to start without the service token. Set `ANTHROPIC_MODEL` if your key's available model differs from the upstream default. Never commit actual keys or put them in browser variables.
4. In Vercel → Project → Settings → Environment Variables, set `AGENT_API_URL` to the agent service's HTTPS address and `AGENT_API_TOKEN` to the same service token. Redeploy the frontend. The token stays in the Next.js server and is checked by Python; users do not enter your Claude key.
5. Open the Vercel URL, check the connection, upload a completed deck, answer the agent, review and download. Confirm with a real key before the demonstration. The demo's shared Claude usage is billed to the configured key; restrict access to your intended demo audience.

The default same-origin Vercel proxy is subject to the [4.5 MB total request limit](https://vercel.com/docs/functions/limitations). Keep demonstration decks small (about 3 MB or less, leaving room for extracted metadata), and the app rejects oversized serialized requests before sending them. Supporting the full local 25 MB limit on Vercel needs direct object-storage uploads and a storage reference passed to the agent.

For a short hackathon, a temporary HTTPS tunnel to the Python service can replace a hosted service. Set the same service token and point Vercel at the tunnel URL; your laptop and agent must stay running. The tunnel is not opened automatically by this project. See [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## Download recovery

New uploads and saved records use stable bytes. If an older report already lost its browser file reference, download explains the recovery: choose New report and upload the exact same .pptx again. Its SHA-256 reconnects it to the saved summary and grade; a new Claude conversation is not needed to export that saved review.

If browser storage rejects a write, ESWriter keeps the edits on the current page, shows Changes not saved, and lets you download a PowerPoint copy after confirming your review. It marks a report Reviewed only after the browser write succeeds. Keep the page open and retry saving once storage is available.

## Chat presentation

Agent question arrays/JSON objects, numbered or bulleted question lists and plain question-per-line messages render as a consistent numbered list. Introductory text, supporting context, answer choices and closing instructions stay visible; unfamiliar shapes stay intact. The original stored messages and agent reply workflow are unchanged. Ordinary prose, emphasis and proposal tables remain readable in live chat and saved history.

## Text fitting and audit deletion

The review screen measures all executive-summary fields against the original PowerPoint boxes, including headings, line breaks, cell margins, and the selected grade definition. It uses source font metrics with a safety allowance, reduces body fonts only as far as 8 pt, and shares the findings table height between rows without enlarging its outside rectangle. The positive-aspects text also reserves the width occupied by the grade box in the supplied deck. Preview and PowerPoint export use the same fitted sizes and explicit line breaks. Text that still cannot fit must be shortened before approval or download; the full user text remains saved. Source fonts need to be available in the viewing application for matching metrics.

Previous audits has a Delete action with confirmation. It removes that report’s source bytes, summary edits and saved conversation from this browser after the storage operation succeeds. The original uploaded file is unaffected.

For the focused private-deck check, set `REPORT_PPTX` to a local reference `.pptx` and run `npx playwright test tests/report-fit.spec.ts`; the fixture is never bundled. The check uses explicit test responses and makes no Claude calls.
