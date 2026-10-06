# ESWriter
<!-- impeccable:product-schema 1 -->
## Platform
web
## Stack
Next.js, TypeScript, Tailwind; local Python / LangGraph / Claude agent. Vercel hosts the frontend, while the connected hackathon demo runs both services locally.
## Users
Internal audit preparers completing executive summaries for audit reports.
## Product Purpose
The user uploads an audit PowerPoint whose other sections are already filled. The agent reads its evidence, asks follow-up questions, recommends an overall process mitigation grade, and prepares the executive-summary slide. The user reviews the whole presentation, edits summary content in its source cells, changes the A–D grade through a dropdown, and downloads a PowerPoint copy.
## Capabilities and Constraints
User changed the original template-setup scope on 6 October 2026 and renamed the app ESWriter. The uploaded anonymized reference contains 13 slides. Its Executive Summary slide 4 has native Audit conclusion and Positive aspects cells, a Main findings/recommendation/owner table, a large colored B grade square, and a separate Process risk (gross) field. The large grade square becomes the dropdown; the gross-risk field and other source sections remain independent and unchanged. The second Executive Summary slide contains closing-meeting/acknowledgement text and is retained.
The main flow needs no reusable-template setup or manual evidence re-entry. User replaced Templates with Previous audits on 6 October 2026. The history lists uploaded reports with their status, selected grade and update date; saved summaries reopen for local editing/export even after agent sessions expire. Source bytes and review/session snapshots persist in IndexedDB; live agent checkpoints remain in memory. No fake provider is exposed in the runnable demo.
## Agent Authority
User explicitly requested the latest SAAF-Project/Executive-Summary-Writer commit. Pinned cd950925efacd756c6d9da5a10ce7b502b3b0ac3, checked 6 October 2026. It owns root cause, relationships, storyline, positive aspects, grade proposal/confirmation, tone, challenge review, board summary and finding recommendations. ESWriter adds an initial deck-reading call and HTTP/UI adapters; output-to-cell mapping is deterministic. Grade recommendation and user selection are retained separately.
## Brand Commitments
Keep the incumbent clean white, navy/blue corporate interface, restrained gray, native typography and flat controls. App name ESWriter. Do not copy uploaded logos into application chrome. A–D grade colors and definitions come from the supplied grading table and match the latest agent's criteria.
## Product Principles
Use the uploaded report as evidence, distinguish original content, AI output and human corrections. Preserve unrelated source parts. Show no AI recommendation before an actual model response. Keep grading evidence and uncertainty visible, with user correction through a native dropdown. Include the reviewed grade's exact definition in the conclusion, so changes stay consistent.
## Limits
Preview is approximate, not a PowerPoint rendering engine. Readable text/tables/notes are analyzed; chart/image-only evidence is retained but not interpreted. Exact thumbnails, shared authentication/cloud storage, durable agent sessions and whole-deck editing remain beyond this hackathon scope. Live Claude output and audit quality need the user's API key; deterministic automated providers are test-only.
