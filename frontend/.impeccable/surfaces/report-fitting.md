# Presentation text fitting

Mode: Operate. Targets: src/components/report-deck-review.tsx, src/components/slide-preview.tsx, src/lib/report-fit.ts. Preserve the incumbent corporate workspace.

The user requires summary text to fit its real boxes. Show fitted source fonts and line breaks in preview and export, retain native editable content, include the grade definition, preserve outer geometry and unrelated parts, and use a minimum body size of 8 pt. Stop approval/download on overflow and preserve all user text. Measure glyphs and explicit lines rather than character counts. Account for the grade obstacle in the positive-aspects box and allocate finding rows within their fixed table.

Checked with one focused private-deck browser flow and exported-slide rendering. Browser desktop 1440 and mobile 390 passed fit/width checks; only slide4.xml changed. No live Claude calls.
