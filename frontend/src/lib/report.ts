import JSZip from "jszip";
import type { PresentationMetadata, SourceField, SlideMetadata } from "./types";

export const PROCESS_GRADES = [
  { grade: "A", color: "#00b050", label: "Well mitigated", definition: "Risks identified in the audited process are well mitigated. Limited actions might be required." },
  { grade: "B", color: "#ffff00", label: "Adequately mitigated", definition: "Risks identified in the audited process are adequately mitigated but actions are required on weaker aspects." },
  { grade: "C", color: "#ffc000", label: "Not sufficiently mitigated", definition: "Risks identified in the audited process are not sufficiently mitigated (one or more). Short-term actions are required." },
  { grade: "D", color: "#ff0000", label: "Not mitigated", definition: "Risks identified in the audited process are not mitigated (one or more). Immediate actions are required." },
] as const;
export type ProcessGrade = typeof PROCESS_GRADES[number]["grade"];
export type ReportField = { id: string; label: string; slideId: string; slideIndex: number; source: SourceField; prefix?: string; maxChars: number };
export type ReportPlan = { summaryFields: ReportField[]; gradeField: ReportField | null; gradeLabel: ReportField | null; summarySlideId: string | null };
export type ReportEdits = { fields: Record<string, string>; grade: ProcessGrade | null; reviewed: boolean };

const normalized = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
/** Header of the executive summary slide: small tables of a label and, in the next cell, its value. */
const HEADER_FIELDS = [
  { label: "Audit title", matches: (text: string) => text === "audit title" },
  { label: "Domain", matches: (text: string) => text === "domain" },
  { label: "Process risk (gross)", matches: (text: string) => text.startsWith("process risk") },
  { label: "Key figures", matches: (text: string) => text === "key figures" },
];
export function reportPlan(metadata: PresentationMetadata): ReportPlan {
  const slides = metadata.slides.filter(slide => /^(executive summary|executive overview)$/i.test(slide.title.trim()));
  const plan: ReportPlan = { summaryFields: [], gradeField: null, gradeLabel: null, summarySlideId: slides[0]?.id ?? null };
  function field(slide: SlideMetadata, source: SourceField, label: string, maxChars: number, prefix?: string): ReportField {
    return { id: source.id, source, slideId: slide.id, slideIndex: slide.index, label, maxChars, ...(prefix ? { prefix } : {}) };
  }
  for (const slide of slides) {
    for (const source of slide.fields) {
      const text = normalized(source.sourceText);
      if (text.startsWith("audit conclusion")) plan.summaryFields.push(field(slide, source, "Audit conclusion", 1800, "Audit conclusion"));
      else if (text.startsWith("positive aspects")) plan.summaryFields.push(field(slide, source, "Positive aspects", 650, "Positive aspects"));
      else if (/^process grade/.test(text)) {
        const adjacent = slide.fields.find(candidate => candidate.shapeId === source.shapeId && candidate.row === source.row && candidate.column === (source.column ?? 0) + 1);
        if (adjacent) { plan.gradeLabel = field(slide, source, "Process grade label", 80); plan.gradeField = field(slide, adjacent, "Process grade", 100); }
      } else if (source.location === "table-cell") {
        const header = HEADER_FIELDS.find(item => item.matches(text));
        const value = header && slide.fields.find(candidate => candidate.shapeId === source.shapeId && candidate.row === source.row && candidate.column === (source.column ?? 0) + 1);
        if (header && value) plan.summaryFields.push(field(slide, value, header.label, 120));
      }
    }
    const grade = slide.fields.find(source => /^[A-D]$/.test(source.sourceText.trim()) && slide.elements.some(element => element.id === `${slide.id}-${source.shapeId}` && element.width > 4 && element.height > 6 && (element.fontSize ?? 0) > 2));
    if (grade) { plan.gradeField = field(slide, grade, "Process grade", 100); plan.gradeLabel = null; }
    const findings = slide.fields.find(source => normalized(source.sourceText).startsWith("main findings") && source.location === "table-cell");
    if (findings) {
      slide.fields.filter(source => source.shapeId === findings.shapeId && (source.row ?? 0) > 0).forEach(source => {
        const column = ["Main finding", "Recommendation", "Finding owner"][source.column ?? 0] ?? "Finding";
        plan.summaryFields.push(field(slide, source, `${column} ${source.row}`, source.column === 0 ? 360 : source.column === 1 ? 280 : 100));
      });
    }
  }
  if (!plan.summaryFields.length && slides[0]) {
    const source = slides[0].fields.find(item => item.location === "text-box" && !/^\d+$/.test(item.sourceText.trim()) && !/^(executive summary|introduction|process dashboard|finding overview|findings and recommendations|appendices)$/i.test(item.sourceText.trim()));
    if (source) plan.summaryFields.push(field(slides[0], source, "Executive summary", 2400));
  }
  return plan;
}
export function sourceBody(field: ReportField): string {
  return field.prefix ? field.source.sourceText.replace(new RegExp(`^${field.prefix}\\s*`, "i"), "") : field.source.sourceText;
}
export function presentationEdits(plan: ReportPlan, fields: Record<string, string>, grade: ProcessGrade | null): Record<string, string> {
  const result = Object.fromEntries(plan.summaryFields.filter(field => fields[field.id] !== undefined).map(field => [field.id, (field.prefix ? `${field.prefix}\n` : "") + fields[field.id] + (field.prefix === "Audit conclusion" && grade ? `\n\nProcess grade ${grade}. ${PROCESS_GRADES.find(item => item.grade === grade)!.definition}` : "")]));
  if (grade && plan.gradeField) result[plan.gradeField.id] = grade;
  if (grade && plan.gradeLabel) result[plan.gradeLabel.id] = "Process grade";
  return result;
}

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
function direct(node: Element, name: string) { return Array.from(node.children).filter(child => child.localName === name); }
function replaceBody(body: Element, value: string, prefix?: string) {
  const doc = body.ownerDocument;
  const original = direct(body, "p");
  const keepHeader = !!prefix && original.length > 0 && (original[0].textContent ?? "").trim().toLowerCase() === prefix.toLowerCase();
  const style = original[keepHeader ? 1 : 0] ?? original[0];
  const content = keepHeader && prefix ? value.replace(new RegExp(`^${prefix}\\s*`, "i"), "") : value;
  for (const p of original.slice(keepHeader ? 1 : 0)) body.removeChild(p);
  for (const line of content.split("\n")) {
    const p = doc.createElementNS(A, "a:p");
    const pPr = style && direct(style, "pPr")[0];
    if (pPr) p.appendChild(pPr.cloneNode(true));
    const r = doc.createElementNS(A, "a:r");
    const rPr = style?.getElementsByTagNameNS(A, "rPr")[0];
    if (rPr) r.appendChild(rPr.cloneNode(true));
    const text = doc.createElementNS(A, "a:t"); text.textContent = line;
    r.appendChild(text); p.appendChild(r); body.appendChild(p);
  }
}
export async function exportReport(source: Blob, metadata: PresentationMetadata, plan: ReportPlan, fields: Record<string, string>, grade: ProcessGrade | null): Promise<Blob> {
  let bytes: ArrayBuffer;
  try { bytes = await source.arrayBuffer(); }
  catch { throw new Error("Your browser can no longer read the original presentation. Upload the same .pptx again to restore it; your saved summary edits will be kept."); }
  if (!bytes.byteLength) throw new Error("The original presentation is missing. Upload the same .pptx again to restore it; your saved summary edits will be kept.");
  const zip = await JSZip.loadAsync(bytes);
  const edits = presentationEdits(plan, fields, grade);
  const allowed = [...plan.summaryFields, ...(plan.gradeField ? [plan.gradeField] : []), ...(plan.gradeLabel ? [plan.gradeLabel] : [])];
  for (const slide of metadata.slides) {
    const targets = allowed.filter(field => field.slideId === slide.id && edits[field.id] !== undefined);
    if (!targets.length) continue;
    const entry = zip.file(slide.part); if (!entry) throw new Error("The original slide is missing. Upload the presentation again.");
    const doc = new DOMParser().parseFromString(await entry.async("string"), "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("The source slide could not be edited.");
    for (const target of targets) {
      const node = Array.from(doc.getElementsByTagNameNS(P, "cNvPr")).find(item => item.getAttribute("id") === target.source.shapeId)?.parentElement?.parentElement;
      if (!node) throw new Error(`The ${target.label} source object could not be found.`);
      let body: Element | undefined;
      let cell: Element | undefined;
      if (target.source.location === "table-cell") {
        const row = node.getElementsByTagNameNS(A, "tr")[target.source.row ?? 0];
        cell = row && direct(row, "tc")[target.source.column ?? 0];
        body = cell && direct(cell, "txBody")[0];
      } else body = direct(node, "txBody")[0];
      if (!body) throw new Error(`The ${target.label} content area could not be found.`);
      replaceBody(body, edits[target.id], target.prefix);
      if (target.id === plan.gradeField?.id && grade) {
        const properties = cell ? direct(cell, "tcPr")[0] ?? doc.createElementNS(A, "a:tcPr") : direct(node, "spPr")[0];
        if (!properties) throw new Error("The process grade styling could not be preserved.");
        if (cell && !properties.parentNode) cell.appendChild(properties);
        for (const fill of Array.from(properties.children).filter(item => /^(solidFill|gradFill|noFill|pattFill|blipFill)$/.test(item.localName))) properties.removeChild(fill);
        const fill = doc.createElementNS(A, "a:solidFill"); const rgb = doc.createElementNS(A, "a:srgbClr");
        rgb.setAttribute("val", PROCESS_GRADES.find(item => item.grade === grade)!.color.slice(1)); fill.appendChild(rgb); properties.appendChild(fill);
        for (const rPr of Array.from(body.getElementsByTagNameNS(A, "rPr"))) {
          for (const old of direct(rPr, "solidFill")) rPr.removeChild(old);
          const ink = doc.createElementNS(A, "a:solidFill"); const black = doc.createElementNS(A, "a:srgbClr"); black.setAttribute("val", "000000"); ink.appendChild(black); rPr.appendChild(ink);
        }
      }
    }
    zip.file(slide.part, new XMLSerializer().serializeToString(doc), { createFolders: false });
  }
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", compression: "DEFLATE" });
}
