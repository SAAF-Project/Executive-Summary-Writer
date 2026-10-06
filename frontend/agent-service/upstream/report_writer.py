"""Writes the Executive Board summary onto the report deck it was made from.

In the report template, the section "Executive summary" has three places to fill on one slide:

- the block that starts with "Audit conclusion" gets the summary;
- the block that starts with "Positive aspects" gets the positive points, as bullets;
- the table that starts with "Main findings" gets one row per negative point: the finding under
  "Main findings" and its recommendation under "Recommendation", followed by a note that it was
  suggested by AI. The third column gets the finding owner, which is read from the finding slide
  ("We recommend the <owner> to:") and not written by the model.

Two more places are filled from the finding slides themselves, without the model: every slide with
the title "Findings and recommendations" states the title of its finding and "Risk: High", "Risk:
Medium" or "Risk: Low".

- the "Findings" box on the executive summary slide (H / M / L) gets the number of findings per level;
  the square next to it gets the overall grade (A-D) that the audit manager chose, in its colour;
- the table in the section "Finding overview" gets one row per finding, with a 1 under its level, and
  the same numbers in the row "Total".

The header of the executive summary slide is four small tables of a label and a value:

- "Audit title" gets the title on the first slide of the deck;
- "Domain" and "Process risk (gross)" get what the audit manager chose;
- "Key figures" gets a placeholder that stands out, for the audit manager to complete.

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

from report_sections import (
    RISK_LEVELS,
    count_risks,
    finding_owner,
    locate_sections,
    read_audit_title,
    read_finding_table,
    read_findings,
)

logger = logging.getLogger(__name__)

SUMMARY_SECTION = "Executive summary"
SUMMARY_BLOCK = "Audit conclusion"
SUMMARY_HEADING = "Executive Board Summary"
POSITIVE_BLOCK = "Positive aspects"
FINDINGS_TABLE = "Main findings"
# labels of the header tables on the executive summary slide
HEADER_TITLE = "Audit title"
HEADER_DOMAIN = "Domain"
HEADER_RISK = "Process risk"
HEADER_FIGURES = "Key figures"
# the key figures are not known to the agent: the audit manager completes them
KEY_FIGURES_PLACEHOLDER = "[KEY FIGURES: TO BE ADDED]"
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


def fill_findings_table(
    deck: Any,
    findings: Dict[str, str],
    model: str,
    titles: Optional[Dict[str, str]] = None,
) -> int:
    """Write one row per finding: the finding in the first column, its recommendation in the second.

    `findings` maps a main finding to its recommendation, and `model` is named in the AI note after
    each recommendation. `titles` maps a main finding to the title of its finding slide; with it, the
    third column gets the finding owner that this slide names. Where no owner is found the cell is
    left for the audit manager. Returns the slide number.

    The table keeps its size on the slide: when the texts are too long for it, they are set in a
    smaller font, and the height of the table is shared out over the rows by what each one needs.
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
    owner_cell = list(rows[0].cells)[2:3]
    if owner_cell and owner_cell[0].text_frame.paragraphs[0].runs:
        models.append(_model_paragraph(owner_cell[0].text_frame.paragraphs[0]))
    elif owner_cell:
        models.append(models[1])
    # the owner of a finding is looked up on its finding slide, by the title of the finding
    table_of_findings = read_finding_table(deck)
    texts = [
        (
            finding.strip(),
            cited(recommendation, model),
            finding_owner((titles or {}).get(finding, ""), table_of_findings) or "",
        )[: len(models)]
        for finding, recommendation in list(findings.items())[: len(rows)]
    ]
    widths = [Emu(column.width).pt - 2 * CELL_MARGIN_PT for column in table.columns]
    # a row without a finding still takes the height of one line
    empty = (len(rows) - len(texts)) * (FONT_SIZES_PT[0] * LINE_HEIGHT + CELL_MARGIN_PT)
    available = sum(Emu(row.height).pt for row in rows) - empty

    def heights(size: int) -> List[float]:
        """The estimated height each row needs at a font size: its longest cell decides."""
        return [
            max(
                math.ceil(len(text) / max(1, int(width / (size * CHAR_WIDTH))))
                for text, width in zip(row, widths)
            )
            * size
            * LINE_HEIGHT
            + CELL_MARGIN_PT
            for row in texts
        ]

    size = next(
        (s for s in FONT_SIZES_PT if sum(heights(s)) <= available), None
    )
    if size is None:
        size = FONT_SIZES_PT[-1]
        logger.warning(
            "[!] The findings are probably too long for the '%s' table on slide %s, even at %s pt. "
            "Check the slide.",
            FINDINGS_TABLE,
            number,
            size,
        )

    for row, row_texts in zip(rows, texts):
        for cell, paragraph, text in zip(row.cells, models, row_texts):
            if not text:
                continue  # no owner found: the cell stays as it is
            _set_cell(cell, paragraph, text)
            cell.text_frame.paragraphs[0].runs[0].font.size = Pt(size)
    # the rows share the height of the table: each written row gets what it needs, and what is
    # left goes to the empty rows (or, without empty rows, to all rows alike)
    needed = heights(size)
    spare = max(0.0, available - sum(needed))
    others = rows[len(texts) :] or rows
    for row, height in zip(rows, needed):
        row.height = Pt(height)
    for row in others:
        start = Emu(row.height).pt if others is rows else empty / len(others)
        row.height = Pt(start + spare / len(others))
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


def fill_header(deck: Any, domain: str = "", process_risk: str = "") -> Dict[str, str]:
    """Fill the header tables of the executive summary slide. Returns label -> value as written.

    Each one is a table of one row: a label and its value. The audit title is read from the first
    slide and the key figures get a placeholder. Domain and process risk are written when given. A
    table that is not on the slide, or a value that is empty, is left out.
    """
    values = {
        HEADER_TITLE: read_audit_title(deck),
        HEADER_DOMAIN: domain,
        HEADER_RISK: process_risk,
        HEADER_FIGURES: KEY_FIGURES_PLACEHOLDER,
    }
    written: Dict[str, str] = {}
    for _, shape in _section_tables(deck):
        table = shape.table
        if len(table.rows) != 1 or len(table.columns) != 2:
            continue
        label, value = table.cell(0, 0), table.cell(0, 1)
        for name, text in values.items():
            if (
                text
                and label.text.strip().startswith(name)
                and value.text_frame.paragraphs[0].runs
            ):
                _set_text(value, text)
                written[name] = text
    return written


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
            # every cell is filled with a copy of a cell of its column that has text; in a report
            # that is filled in already, a column may have its text in any row
            filled = [
                [c for row in body + [total] for c in [row.cells[column]] if c.text_frame.paragraphs[0].runs]
                for column in range(len(table.columns))
            ]
            marks = [cell for column in filled[1:] for cell in column]
            if not filled[0] or not marks:
                raise ValueError(
                    f"The '{OVERVIEW_SECTION}' table has no text to take the format from."
                )
            models = [
                _model_paragraph((column or marks)[0].text_frame.paragraphs[0])
                for column in filled
            ]
            for model in models[1:]:
                for bold in model.iter(f"{{{model.nsmap['a']}}}rPr"):
                    bold.attrib.pop("b", None)  # a mark taken from the row "Total" is bold
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
    domain: str = "",
    process_risk: str = "",
    neg_titles: Optional[Dict[str, str]] = None,
) -> int:
    """Save a copy of the deck `source` with the summary on its executive summary slide.

    The positive points, the findings and the overall grade are written on the same slide when they are
    given, and so are the domain and the process risk in the header. The audit title, the placeholder
    for the key figures and the number of findings per risk level are always written.
    """
    from pptx import Presentation

    deck = Presentation(str(source))
    number = fill_summary_block(deck, summary)
    fill_header(deck, domain, process_risk)
    if pos_points:
        fill_positive_block(deck, pos_points)
    if neg_points:
        fill_findings_table(deck, neg_points, model, neg_titles)
    if grade:
        fill_grade(deck, grade)
    fill_finding_numbers(deck)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    deck.save(str(out_file))
    return number

