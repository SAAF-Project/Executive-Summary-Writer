"""Writes the Executive Board summary onto the report deck it was made from.

In the report template, the section "Executive summary" has three places to fill on one slide:

- the block that starts with "Audit conclusion" gets the summary;
- the block that starts with "Positive aspects" gets the positive points, as bullets;
- the table that starts with "Main findings" gets one row per negative point: the finding under
  "Main findings" and its recommendation under "Recommendation", followed by a note that it was
  suggested by AI.

Two more places are filled from the finding slides themselves, without the model: every slide with
the title "Findings and recommendations" states the title of its finding and "Risk: High", "Risk:
Medium" or "Risk: Low".

- the "Findings" box on the executive summary slide (H / M / L) gets the number of findings per level;
  the square next to it gets the overall grade (A-D) that the audit manager chose, in its colour;
- the table in the section "Finding overview" gets one row per finding, with a 1 under its level, and
  the same numbers in the row "Total".

Placeholder text is replaced; headings and formatting are kept. The input deck is not changed: the
result is saved as a new file.
"""

import copy
import logging
import math
import re
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

from pptx.dml.color import RGBColor
from pptx.util import Emu, Pt

from report_sections import RISK_LEVELS, count_risks, locate_sections, read_findings

logger = logging.getLogger(__name__)

SUMMARY_SECTION = "Executive summary"
SUMMARY_BLOCK = "Audit conclusion"
SUMMARY_HEADING = "Executive Board Summary"
POSITIVE_BLOCK = "Positive aspects"
FINDINGS_TABLE = "Main findings"
COUNTS_BOX = "Findings"
# fill colour of the grade square, as in the grading table of the report
GRADE_COLOURS = {"A": "00B050", "B": "FFFF00", "C": "FFC000", "D": "FF0000"}
OVERVIEW_SECTION = "Finding overview"
OVERVIEW_TOTAL = "Total"
# always added to a recommendation on the slide, so the reader knows where it comes from
AI_NOTE = "(suggested by AI|{model})"

# the block has a fixed place on the slide, so longer text gets a smaller font
FONT_SIZES_PT = (10, 9, 8, 7)
PARAGRAPH_SPACING_PT = 3
# rough text metrics for estimating whether the text fits
CHAR_WIDTH = 0.5  # average character width as a share of the font size
LINE_HEIGHT = 1.2
CELL_MARGIN_PT = 7.2


def slide_text(summary: str) -> List[str]:
    """The paragraphs that go on the slide: the text under "Executive Board Summary".

    The "Potential Gaps" section is for the audit manager and stays out of the report.
    """
    parts = re.split(r"^#+\s*(.+?)\s*$", summary, flags=re.MULTILINE)
    # parts: text before the first heading, then heading, text, heading, text, ...
    sections = dict(zip(parts[1::2], parts[2::2]))
    body = sections.get(SUMMARY_HEADING, parts[0] if len(parts) == 1 else "")
    if not body.strip():
        raise ValueError(
            f'The summary has no text under "{SUMMARY_HEADING}" to put on the slide.'
        )
    paragraphs: List[str] = []
    for block in re.split(r"\n\s*\n", body.strip()):
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if any(line.startswith(("- ", "* ")) for line in lines):
            paragraphs.extend(lines)  # keep list items on their own lines
        else:
            paragraphs.append(" ".join(lines))
    return [p.replace("**", "") for p in paragraphs]


def _section_tables(deck: Any) -> Iterator[Tuple[int, Any]]:
    """(slide number, table shape) for every table in the section "Executive summary"."""
    sections = locate_sections(deck)
    if SUMMARY_SECTION not in sections:
        raise ValueError(
            f"The deck has no section '{SUMMARY_SECTION}' (found: {', '.join(sections)})."
        )
    slides = list(deck.slides)
    for number in sections[SUMMARY_SECTION]:
        for shape in slides[number - 1].shapes:
            if getattr(shape, "has_table", False):
                yield number, shape


def find_block(deck: Any, heading: str) -> Tuple[int, Any, Any]:
    """(slide number, table shape, cell) of the block that starts with `heading`."""
    for number, shape in _section_tables(deck):
        for row in shape.table.rows:
            for cell in row.cells:
                if cell.text.strip().startswith(heading):
                    return number, shape, cell
    raise ValueError(
        f"No block starting with '{heading}' in the section '{SUMMARY_SECTION}'."
    )


def find_summary_block(deck: Any) -> Tuple[int, Any, Any]:
    """(slide number, table shape, cell) of the block that starts with "Audit conclusion"."""
    return find_block(deck, SUMMARY_BLOCK)


def _fitting_size(paragraphs: List[str], shape: Any) -> Optional[int]:
    """The largest font size at which the text is estimated to fit in the block, if any."""
    width = Emu(shape.width).pt - 2 * CELL_MARGIN_PT
    height = Emu(shape.height).pt - 2 * CELL_MARGIN_PT
    for size in FONT_SIZES_PT:
        per_line = max(1, int(width / (size * CHAR_WIDTH)))
        lines = sum(math.ceil(len(p) / per_line) for p in paragraphs)
        needed = (
            FONT_SIZES_PT[0] * LINE_HEIGHT  # the heading keeps its size
            + lines * size * LINE_HEIGHT
            + len(paragraphs) * PARAGRAPH_SPACING_PT
        )
        if needed <= height:
            return size
    return None


def _model_paragraph(paragraph: Any) -> Any:
    """A copy of a placeholder paragraph with one run, to be filled: it keeps font, colour and bullet."""
    model = copy.deepcopy(paragraph._p)
    runs = [child for child in model if child.tag.endswith(("}r", "}br"))]
    for extra in runs[1:]:
        model.remove(extra)
    return model


def _fill_block(deck: Any, block: str, paragraphs: List[str]) -> int:
    """Replace the placeholder under the heading of a block with `paragraphs`. Returns the slide number."""
    number, shape, cell = find_block(deck, block)
    heading, *rest = cell.text_frame.paragraphs
    if not rest or not rest[0].runs:
        raise ValueError(
            f"The '{block}' block has no placeholder text to replace."
        )
    # every new paragraph is a copy of the placeholder, so it keeps font and colour
    model = _model_paragraph(rest[0])
    for paragraph in rest:
        paragraph._p.getparent().remove(paragraph._p)

    size = _fitting_size(paragraphs, shape)
    if size is None:
        size = FONT_SIZES_PT[-1]
        logger.warning(
            "[!] The text is probably too long for the '%s' block on slide %s, even at %s pt. "
            "Check the slide, or ask for a shorter summary with --request.",
            block,
            number,
            size,
        )

    previous = heading._p
    for text in paragraphs:
        element = copy.deepcopy(model)
        previous.addnext(element)
        previous = element
    for paragraph, text in zip(cell.text_frame.paragraphs[1:], paragraphs):
        paragraph.space_after = Pt(PARAGRAPH_SPACING_PT)
        run = paragraph.runs[0]
        run.text = text
        run.font.size = Pt(size)
    return number


def fill_summary_block(deck: Any, summary: str) -> int:
    """Replace the placeholder under "Audit conclusion" with the summary. Returns the slide number."""
    return _fill_block(deck, SUMMARY_BLOCK, slide_text(summary))


def fill_positive_block(deck: Any, points: List[str]) -> int:
    """Replace the placeholder under "Positive aspects" with one bullet per point. Returns the slide number.

    The placeholder of the template is a bullet, and every point is a copy of it.
    """
    return _fill_block(deck, POSITIVE_BLOCK, [p.strip() for p in points])


def cited(recommendation: str, model: str) -> str:
    """A recommendation as it is shown on the slide: with the note that it was suggested by AI."""
    return f"{recommendation.strip()} {AI_NOTE.format(model=model)}"


def find_findings_table(deck: Any) -> Tuple[int, Any]:
    """(slide number, table) of the table whose header starts with "Main findings"."""
    for number, shape in _section_tables(deck):
        if shape.table.cell(0, 0).text.strip().startswith(FINDINGS_TABLE):
            return number, shape.table
    raise ValueError(
        f"No table starting with '{FINDINGS_TABLE}' in the section '{SUMMARY_SECTION}'."
    )


def fill_findings_table(deck: Any, findings: Dict[str, str], model: str) -> int:
    """Write one row per finding: the finding in the first column, its recommendation in the second.

    `findings` maps a main finding to its recommendation, and `model` is named in the AI note after
    each recommendation. The third column (finding owner) is left for the audit manager. Returns the
    slide number.
    """
    number, table = find_findings_table(deck)
    rows = list(table.rows)[1:]  # below the header
    if not rows or not all(
        cell.text_frame.paragraphs[0].runs for cell in list(rows[0].cells)[:2]
    ):
        raise ValueError(
            f"The '{FINDINGS_TABLE}' table has no placeholder row to replace."
        )
    if len(findings) > len(rows):
        logger.warning(
            "[!] The '%s' table on slide %s has %s rows. Not written: %s",
            FINDINGS_TABLE,
            number,
            len(rows),
            "; ".join(list(findings)[len(rows) :]),
        )
    # every cell is filled with a copy of the placeholder above it, so it keeps font and colour
    models = [
        _model_paragraph(cell.text_frame.paragraphs[0])
        for cell in list(rows[0].cells)[:2]
    ]
    for row, (finding, recommendation) in zip(rows, findings.items()):
        texts = (finding.strip(), cited(recommendation, model))
        for cell, paragraph, text in zip(row.cells, models, texts):
            _set_cell(cell, paragraph, text)
    return number


def _set_cell(cell: Any, model: Any, text: str) -> None:
    """Replace the content of a table cell with one paragraph: a copy of `model` with `text`."""
    for old in cell.text_frame.paragraphs:
        old._p.getparent().remove(old._p)
    cell.text_frame._txBody.append(copy.deepcopy(model))
    cell.text_frame.paragraphs[0].runs[0].text = text


def _set_text(shape: Any, text: str) -> None:
    """Replace the text of a shape and keep the format of its first run."""
    first, *extra = shape.text_frame.paragraphs[0].runs
    for run in extra:
        run._r.getparent().remove(run._r)
    first.text = text


def _findings_box(deck: Any) -> Tuple[int, List[Any]]:
    """(slide number, shapes) of the "Findings" box on the executive summary slide.

    The box is a group of shapes: "Findings", the letters H, M and L with a number below each, and a
    square with the overall grade.
    """
    sections = locate_sections(deck)
    slides = list(deck.slides)
    for number in sections.get(SUMMARY_SECTION, []):
        for group in slides[number - 1].shapes:
            shapes = [
                s
                for s in getattr(group, "shapes", [])
                if s.has_text_frame and s.text_frame.paragraphs[0].runs
            ]
            texts = {s.text_frame.text.strip() for s in shapes}
            if texts >= {COUNTS_BOX, *(level[0] for level in RISK_LEVELS)}:
                return number, shapes
    raise ValueError(
        f"No '{COUNTS_BOX}' box with H, M and L in the section '{SUMMARY_SECTION}'."
    )


def fill_finding_counts(deck: Any, counts: List[int]) -> int:
    """Write the number of High, Medium and Low findings in the "Findings" box. Returns the slide number."""
    number, shapes = _findings_box(deck)
    by_text = {s.text_frame.text.strip(): s for s in shapes}
    for level, count in zip(RISK_LEVELS, counts):
        letter = by_text[level[0]]
        below = [s for s in shapes if s.top > letter.top]
        if not below:
            raise ValueError(
                f"The '{COUNTS_BOX}' box has no number below '{level[0]}'."
            )
        target = min(
            below,
            key=lambda s: (abs(s.left - letter.left), s.top - letter.top),
        )
        _set_text(target, str(count))
    return number


def fill_grade(deck: Any, grade: str) -> int:
    """Write the overall grade (A-D) in the square of the "Findings" box, in the colour of that grade."""
    if grade not in GRADE_COLOURS:
        raise ValueError(
            f"Unknown grade '{grade}' (use {', '.join(GRADE_COLOURS)})."
        )
    number, shapes = _findings_box(deck)
    square = next(
        (s for s in shapes if s.text_frame.text.strip() in GRADE_COLOURS), None
    )
    if square is None:
        raise ValueError(f"The '{COUNTS_BOX}' box has no square with a grade.")
    _set_text(square, grade)
    square.fill.solid()
    square.fill.fore_color.rgb = RGBColor.from_string(GRADE_COLOURS[grade])
    return number


def fill_finding_overview(
    deck: Any, findings: List[Tuple[str, Optional[str]]]
) -> int:
    """List every finding in the "Finding overview" table. Returns the slide number.

    One row per finding: its title, and a 1 in the column of its risk level (High, Medium, Low). The
    row "Total" gets the number of findings per level. Rows are added when there are more findings
    than rows, and rows that are not needed are emptied.
    """
    sections = locate_sections(deck)
    slides = list(deck.slides)
    for number in sections.get(OVERVIEW_SECTION, []):
        for shape in slides[number - 1].shapes:
            if not getattr(shape, "has_table", False):
                continue
            table = shape.table
            rows = list(table.rows)
            if len(table.columns) != 1 + len(RISK_LEVELS) or len(rows) < 3:
                continue
            *body, total = rows[1:]
            if not total.cells[0].text.strip().startswith(OVERVIEW_TOTAL):
                continue
            if not all(c.text_frame.paragraphs[0].runs for c in body[0].cells):
                raise ValueError(
                    f"The '{OVERVIEW_SECTION}' table has no placeholder row to replace."
                )
            # every cell is filled with a copy of the placeholder above it
            models = [
                _model_paragraph(cell.text_frame.paragraphs[0])
                for cell in body[0].cells
            ]
            while len(body) < len(findings):
                extra = copy.deepcopy(body[-1]._tr)
                for ext in extra.findall(f"{{{extra.nsmap['a']}}}extLst"):
                    extra.remove(ext)  # the copy must not repeat the id of the row
                body[-1]._tr.addnext(extra)
                shape.height += body[-1].height
                body = list(table.rows)[1:-1]
            for index, row in enumerate(body):
                title, level = findings[index] if index < len(findings) else ("", None)
                marks = ["1" if level == wanted else "" for wanted in RISK_LEVELS]
                for cell, model, text in zip(row.cells, models, [title] + marks):
                    _set_cell(cell, model, text)
            for cell, count in zip(list(total.cells)[1:], count_risks(findings)):
                _set_text(cell, str(count))
            return number
    raise ValueError(
        f"No table with a row '{OVERVIEW_TOTAL}' in the section '{OVERVIEW_SECTION}'."
    )


def fill_finding_numbers(deck: Any) -> List[Tuple[str, Optional[str]]]:
    """Count the findings of the deck per risk level and write the "Findings" box and the overview.

    Returns the findings that were read, as (title, risk level). A deck without finding slides is left
    as it is.
    """
    findings = read_findings(deck)
    if not findings:
        return findings
    counts = count_risks(findings)
    unknown = [title for title, level in findings if level is None]
    if unknown:
        logger.warning(
            "[!] No risk level (High, Medium or Low) recognised for: %s. Not counted.",
            "; ".join(unknown),
        )
    fill_finding_counts(deck, counts)
    fill_finding_overview(deck, findings)
    logger.info(
        "Findings by risk: %s",
        ", ".join(f"{level} {n}" for level, n in zip(RISK_LEVELS, counts)),
    )
    return findings


def write_summary_to_deck(
    source: Path,
    summary: str,
    out_file: Path,
    pos_points: Optional[List[str]] = None,
    neg_points: Optional[Dict[str, str]] = None,
    model: str = "",
    grade: str = "",
) -> int:
    """Save a copy of the deck `source` with the summary on its executive summary slide.

    The positive points, the findings and the overall grade are written on the same slide when they are
    given. The number of findings per risk level is always written, as it is read from the deck itself.
    """
    from pptx import Presentation

    deck = Presentation(str(source))
    number = fill_summary_block(deck, summary)
    if pos_points:
        fill_positive_block(deck, pos_points)
    if neg_points:
        fill_findings_table(deck, neg_points, model)
    if grade:
        fill_grade(deck, grade)
    fill_finding_numbers(deck)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    deck.save(str(out_file))
    return number

