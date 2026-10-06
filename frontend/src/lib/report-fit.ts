import JSZip from "jszip";
import type { PresentationMetadata } from "./types";
import type { ReportField } from "./report";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
export const MIN_REPORT_FONT_PT = 8;
export const REPORT_LINE_HEIGHT = 1.15;
const EMU = 12700;
const direct = (node: Element | null, name: string) => node ? Array.from(node.children).filter(child => child.localName === name) : [];
const first = (node: Element | null, name: string) => direct(node, name)[0] ?? null;
const num = (node: Element | null, name: string, fallback: number) => node?.hasAttribute(name) ? Number(node.getAttribute(name)) : fallback;
const xml = (value: string) => {
  const doc = new DOMParser().parseFromString(value, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("The presentation layout could not be measured. Upload a fresh PowerPoint copy.");
  return doc;
};
export type TextBoxLayout = {
  width: number; height: number; left: number; right: number; top: number; bottom: number;
  fontSize: number; fontFamily: string; bold: boolean; headingSize: number;
  tableId?: string; row?: number; column?: number;
};
type TableLayout = { heights: number[]; height: number; headerHeight: number };
export type ReportLayout = { fields: Record<string, TextBoxLayout>; tables: Record<string, TableLayout>; slideWidth: number };
export type FitParagraph = { lines: string[]; size: number; bold: boolean; left: number };
export type FieldFit = TextBoxLayout & { fits: boolean; size: number; needed: number; paragraphs: FitParagraph[]; reason?: string };
export type ReportFit = { fields: Record<string, FieldFit>; rowHeights: Record<string, number[]> };
const cache = new WeakMap<Blob, Promise<ReportLayout>>();

/** Read physical source geometry once, also for audits saved before fit metadata existed. */
export function loadReportLayout(source: Blob, metadata: PresentationMetadata): Promise<ReportLayout> {
  const existing = cache.get(source);
  if (existing) return existing;
  const promise = readLayout(source, metadata);
  cache.set(source, promise);
  void promise.catch(() => cache.delete(source));
  return promise;
}
async function readLayout(source: Blob, metadata: PresentationMetadata): Promise<ReportLayout> {
  const zip = await JSZip.loadAsync(await source.arrayBuffer());
  const result: ReportLayout = { fields: {}, tables: {}, slideWidth: metadata.width / EMU };
  const fonts: Record<string, string> = { "+mn-lt": "Arial", "+mj-lt": "Arial" };
  const theme = zip.file("ppt/theme/theme1.xml");
  if (theme) {
    const doc = xml(await theme.async("string"));
    for (const [key, tag] of [["+mn-lt", "minorFont"], ["+mj-lt", "majorFont"]]) {
      const font = first(doc.getElementsByTagNameNS(A, tag)[0] ?? null, "latin")?.getAttribute("typeface");
      if (font) fonts[key] = font;
    }
  }
  function styles(body: Element | null, width: number, height: number, margins: Element | null, table: boolean): TextBoxLayout {
    const paragraphs = direct(body, "p");
    const heading = /^(Audit conclusion|Positive aspects)$/i.test(paragraphs[0]?.textContent?.trim() ?? "");
    const paragraph = paragraphs[heading ? 1 : 0] ?? paragraphs[0];
    const run = paragraph?.getElementsByTagNameNS(A, "rPr")[0] ?? first(first(paragraph ?? null, "pPr"), "defRPr");
    const baseRun = body?.getElementsByTagNameNS(A, "rPr")[0];
    const font = first(run ?? baseRun ?? null, "latin")?.getAttribute("typeface") ?? "+mn-lt";
    return {
      width, height, left: num(margins, table ? "marL" : "lIns", 91440) / EMU,
      right: num(margins, table ? "marR" : "rIns", 91440) / EMU,
      top: num(margins, table ? "marT" : "tIns", 45720) / EMU,
      bottom: num(margins, table ? "marB" : "bIns", 45720) / EMU,
      fontSize: num(run ?? baseRun ?? null, "sz", 1000) / 100, fontFamily: fonts[font] ?? font,
      bold: run?.getAttribute("b") === "1", headingSize: num(baseRun ?? null, "sz", 1000) / 100,
    };
  }
  await Promise.all(metadata.slides.map(async slide => {
    const part = zip.file(slide.part);
    if (!part) throw new Error("The original slide is missing. Upload the presentation again.");
    const doc = xml(await part.async("string"));
    for (const sourceField of slide.fields) {
      const node = Array.from(doc.getElementsByTagNameNS(P, "cNvPr")).find(item => item.getAttribute("id") === sourceField.shapeId)?.parentElement?.parentElement;
      const element = slide.elements.find(item => item.id === `${slide.id}-${sourceField.shapeId}`);
      if (!node || !element) continue;
      const width = element.width / 100 * metadata.width / EMU;
      const height = element.height / 100 * metadata.height / EMU;
      if (sourceField.location === "table-cell") {
        const table = node.getElementsByTagNameNS(A, "tbl")[0];
        const rows = direct(table, "tr");
        const widths = direct(first(table, "tblGrid"), "gridCol").map(col => num(col, "w", 0));
        const totalWidth = widths.reduce((a, b) => a + b, 0);
        const heights = rows.map(row => num(row, "h", 1));
        const totalHeight = heights.reduce((a, b) => a + b, 0);
        const row = sourceField.row ?? 0, column = sourceField.column ?? 0;
        const cell = direct(rows[row], "tc")[column];
        if (!cell || !totalWidth || !totalHeight) continue;
        const colSpan = num(cell, "gridSpan", 1), rowSpan = num(cell, "rowSpan", 1);
        const cellWidth = widths.slice(column, column + colSpan).reduce((a, b) => a + b, 0) / totalWidth * width;
        const cellHeight = heights.slice(row, row + rowSpan).reduce((a, b) => a + b, 0) / totalHeight * height;
        const tableId = `${slide.id}-${sourceField.shapeId}`;
        result.fields[sourceField.id] = { ...styles(first(cell, "txBody"), cellWidth, cellHeight, first(cell, "tcPr"), true), tableId, row, column };
        if (!result.tables[tableId]) result.tables[tableId] = { height, heights: heights.map(h => h / totalHeight * height), headerHeight: heights[0] / totalHeight * height };
      } else {
        const body = first(node, "txBody");
        result.fields[sourceField.id] = styles(body, width, height, first(body, "bodyPr"), false);
      }
    }
  }));
  // This template's grade occupies the right side of the positive-aspects table.
  // Reserve that width rather than allowing generated observations underneath it.
  for (const slide of metadata.slides) {
    const grade = slide.fields.find(field => /^[A-D]$/.test(field.sourceText.trim()) && slide.elements.some(e => e.id === `${slide.id}-${field.shapeId}` && e.width > 4 && e.height > 6 && (e.fontSize ?? 0) > 2));
    const obstacle = grade && slide.elements.find(e => e.id === `${slide.id}-${grade.shapeId}`);
    for (const field of slide.fields.filter(f => /^positive aspects/i.test(f.sourceText.trim()))) {
      const box = slide.elements.find(e => e.id === `${slide.id}-${field.shapeId}`);
      const layout = result.fields[field.id];
      if (box && obstacle && layout && obstacle.x > box.x && obstacle.x < box.x + box.width && obstacle.y < box.y + box.height && obstacle.y + obstacle.height > box.y) {
        layout.right = Math.max(layout.right, (box.x + box.width - obstacle.x) / 100 * result.slideWidth + 4);
      }
    }
  }
  await document.fonts.ready;
  return result;
}

function measureParagraph(text: string, width: number, size: number, family: string, bold: boolean, context: CanvasRenderingContext2D): { lines: string[]; fits: boolean } {
  context.font = `${bold ? "bold " : ""}${size * 4 / 3}px ${JSON.stringify(family)}`;
  const measure = (s: string) => context.measureText(s).width * 3 / 4;
  const lines: string[] = [];
  let line = "", fits = true;
  // Include actual glyph widths; a string of W's has a different capacity from i's.
  for (const token of text.match(/\s+|\S+/gu) ?? []) {
    if (measure(line + token) <= width) { line += token; continue; }
    if (line.trim()) { lines.push(line.trimEnd()); line = ""; }
    if (!token.trim()) continue;
    for (const glyph of Array.from(token)) {
      if (measure(line + glyph) > width && line) { lines.push(line); line = ""; }
      if (measure(glyph) > width) fits = false;
      line += glyph;
    }
  }
  lines.push(line.trimEnd());
  return { lines, fits };
}
export function fitReport(layout: ReportLayout, fields: ReportField[], values: Record<string, string>): ReportFit {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("This browser cannot check text fit. Open ESWriter in a browser with canvas support.");
  const result: ReportFit = { fields: {}, rowHeights: {} };
  function measure(field: ReportField, size: number): FieldFit {
    const box = layout.fields[field.id];
    if (!box) return { width: 0, height: 0, left: 0, right: 0, top: 0, bottom: 0, fontFamily: "Arial", fontSize: 10, headingSize: 10, bold: false, size: 10, needed: Infinity, paragraphs: [], fits: false, reason: "Layout unavailable. Re-upload this presentation." };
    const width = (box.width - box.left - box.right) * .95;
    let horizontalFit = width > 0;
    const paragraphs = (values[field.id] ?? "").replace(/\r\n?/g, "\n").split("\n").map((text, i) => {
      const heading = !!field.prefix && i === 0;
      const pointSize = heading ? box.headingSize : size;
      const left = field.label === "Positive aspects" && !heading && text.trim() ? 13.5 : 0;
      const wrapped = measureParagraph(text, Math.max(0, width - left), pointSize, box.fontFamily, heading || box.bold, context!);
      horizontalFit &&= wrapped.fits;
      return { lines: wrapped.lines, size: pointSize, bold: heading || box.bold, left };
    });
    const needed = paragraphs.reduce((h, p) => h + p.lines.length * p.size * REPORT_LINE_HEIGHT, 0) + box.top + box.bottom + .75;
    return { ...box, size, paragraphs, needed, fits: horizontalFit && needed <= box.height };
  }
  const grouped = new Set<string>();
  // Main findings can share the existing table height; its outside rectangle never grows.
  for (const field of fields.filter(f => f.label.startsWith("Main finding "))) {
    const tableId = layout.fields[field.id]?.tableId;
    if (!tableId || grouped.has(tableId)) continue;
    grouped.add(tableId);
    const targets = fields.filter(f => layout.fields[f.id]?.tableId === tableId);
    const table = layout.tables[tableId];
    const header = Math.max(table.headerHeight, ...Object.entries(layout.fields).filter(([, f]) => f.tableId === tableId && f.row === 0).map(([, f]) => f.fontSize * REPORT_LINE_HEIGHT + f.top + f.bottom + .75));
    let measured: FieldFit[] = [], heights: number[] = [], fits = false;
    const largest = Math.max(MIN_REPORT_FONT_PT, ...targets.map(f => layout.fields[f.id].fontSize));
    for (let size = largest; size >= MIN_REPORT_FONT_PT; size -= .5) {
      measured = targets.map(f => measure(f, Math.min(size, Math.max(MIN_REPORT_FONT_PT, layout.fields[f.id].fontSize))));
      heights = table.heights.map((_, row) => row === 0 ? header : Math.max(MIN_REPORT_FONT_PT * REPORT_LINE_HEIGHT + 7, ...measured.filter(f => f.row === row).map(f => f.needed)));
      // Vertical fit is judged against redistributed rows, not the old uneven rows.
      const horizontal = measured.every(f => f.width - f.left - f.right > 0 && f.paragraphs.every(p => p.lines.every(line => {
        context!.font = `${p.bold ? "bold " : ""}${p.size * 4 / 3}px ${JSON.stringify(f.fontFamily)}`;
        return context!.measureText(line).width * 3 / 4 <= (f.width - f.left - f.right) * .95 - p.left + .01;
      })));
      fits = horizontal && heights.reduce((a, b) => a + b, 0) <= table.height;
      if (fits) break;
    }
    const spare = Math.max(0, table.height - heights.reduce((a, b) => a + b, 0));
    if (fits) for (let i = 1; i < heights.length; i++) heights[i] += spare / (heights.length - 1);
    result.rowHeights[tableId] = fits ? heights : table.heights;
    targets.forEach((target, i) => { result.fields[target.id] = { ...measured[i], height: result.rowHeights[tableId][measured[i].row!], fits, ...(!fits ? { reason: "Shorten the findings table. It cannot fit at 8 pt." } : {}) }; });
  }
  for (const field of fields) {
    if (result.fields[field.id]) continue;
    const box = layout.fields[field.id];
    const base = Math.max(MIN_REPORT_FONT_PT, box?.fontSize ?? 10);
    let fitted = measure(field, base);
    for (let size = base - .5; !fitted.fits && size >= MIN_REPORT_FONT_PT; size -= .5) fitted = measure(field, size);
    result.fields[field.id] = { ...fitted, ...(!fitted.fits && !fitted.reason ? { reason: "Shorten this text. It cannot fit at 8 pt." } : {}) };
    if (box?.tableId && layout.tables[box.tableId].heights.length === 1) result.rowHeights[box.tableId] = [box.height];
  }
  return result;
}
