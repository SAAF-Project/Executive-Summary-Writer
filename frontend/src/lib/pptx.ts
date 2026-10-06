import JSZip from "jszip";
import type { PresentationMetadata, PreviewElement, Rect, SlideMetadata, SourceField } from "./types";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 120 * 1024 * 1024;
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_SLIDES = 100;
const MAX_ELEMENTS = 5000;
const EMU_PER_POINT = 12700;

export class PresentationError extends Error {
  constructor(message: string) { super(message); this.name = "PresentationError"; }
}

// Check declared archive sizes BEFORE inflation. ZIP64, encrypted and oversized
// archives are intentionally outside this MVP's supported PowerPoint subset.
function validateArchive(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 22 || view.getUint32(0, true) !== 0x04034b50) {
    throw new PresentationError("This file is not a valid PowerPoint presentation. Export it as .pptx and try again.");
  }
  let end = -1;
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === view.byteLength) { end = i; break; }
  }
  if (end < 0) throw new PresentationError("The presentation archive is incomplete. Upload a fresh copy.");
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count === 65535 || count > 2500 || offset + directorySize > end) {
    throw new PresentationError("This presentation is too complex for the preview. Use a standard .pptx with up to 100 slides.");
  }
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new PresentationError("The presentation archive is damaged.");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const expanded = view.getUint32(offset + 24, true);
    if ((flags & 1) || ![0, 8].includes(method)) throw new PresentationError("Encrypted or unsupported presentations cannot be opened. Save an unprotected .pptx copy.");
    total += expanded;
    if (expanded > MAX_ENTRY_BYTES || total > MAX_EXPANDED_BYTES) throw new PresentationError("The expanded presentation is too large. Compress its images and try again.");
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  if (offset > end || total > Math.max(buffer.byteLength * 250, 4 * 1024 * 1024)) throw new PresentationError("The archive exceeds safe preview limits. Save a simplified PowerPoint copy.");
}

const children = (node: Element | Document | null, name?: string): Element[] =>
  node ? Array.from(node.children).filter(el => !name || el.localName === name) : [];
const child = (node: Element | Document | null, name: string) => children(node, name)[0] ?? null;
const descendants = (node: Element | Document | null, name: string): Element[] =>
  node ? Array.from(node.getElementsByTagNameNS("*", name)) : [];
const first = (node: Element | Document | null, name: string) => descendants(node, name)[0] ?? null;
const number = (el: Element | null, attribute: string, fallback = 0) => {
  const value = Number(el?.getAttribute(attribute));
  return Number.isFinite(value) && el?.hasAttribute(attribute) ? value : fallback;
};
const plainText = (node: Element | null) => children(node, "p").map(p =>
  children(p).map(run => run.localName === "br" ? "\n" : descendants(run, "t").map(t => t.textContent ?? "").join("")).join("")
).join("\n");

function parseXml(text: string): Document {
  if (text.length > 8 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new PresentationError("The presentation contains unsupported XML content.");
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length || !document.documentElement) throw new PresentationError("A slide could not be read. Save the file again in PowerPoint.");
  return document;
}

function resolvePart(base: string, target: string): string | null {
  if (!target || /^[a-z]+:/i.test(target) || target.includes("\\")) return null;
  const segments = target.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") { if (!segments.length) return null; segments.pop(); }
    else if (segment && segment !== ".") segments.push(segment);
  }
  return segments.join("/");
}
type Relationship = { id: string; type: string; part: string | null };
type Theme = Record<string, string>;
type Transform = { x: number; y: number; scaleX: number; scaleY: number };

function color(node: Element | null, theme: Theme, fallback = "#293a65"): string {
  const rgb = node?.localName === "srgbClr" ? node : first(node, "srgbClr");
  if (rgb && /^[a-f\d]{6}$/i.test(rgb.getAttribute("val") ?? "")) return `#${rgb.getAttribute("val")}`;
  const system = first(node, "sysClr");
  if (system && /^[a-f\d]{6}$/i.test(system.getAttribute("lastClr") ?? "")) return `#${system.getAttribute("lastClr")}`;
  const scheme = node?.localName === "schemeClr" ? node : first(node, "schemeClr");
  const name = scheme?.getAttribute("val") ?? "";
  const alias: Record<string, string> = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };
  return theme[alias[name] ?? name] ?? fallback;
}
function fill(node: Element | null, theme: Theme): string {
  if (child(node, "noFill")) return "transparent";
  const solid = child(node, "solidFill");
  if (solid) return color(solid, theme);
  const gradient = child(node, "gradFill");
  if (gradient) {
    const stops = descendants(gradient, "gs").map(stop => `${color(stop, theme)} ${number(stop, "pos") / 1000}%`);
    return stops.length ? `linear-gradient(100deg, ${stops.join(", ")})` : "transparent";
  }
  return "transparent";
}
function shapeId(node: Element): string { return first(node, "cNvPr")?.getAttribute("id") ?? "0"; }
function placeholder(node: Element): Element | null { return first(node, "ph"); }
function matchPlaceholder(node: Element, tree: Element | null): Element | null {
  const ph = placeholder(node);
  if (!ph) return null;
  return children(tree, "sp").find(candidate => {
    const other = placeholder(candidate);
    if (!other) return false;
    if (ph.hasAttribute("idx")) return other.getAttribute("idx") === ph.getAttribute("idx");
    return (ph.getAttribute("type") ?? "body") === (other.getAttribute("type") ?? "body");
  }) ?? null;
}

function bounds(node: Element, inherited: Element | null, slide: { width: number; height: number }, transform: Transform): Rect {
  const own = child(child(node, "spPr"), "xfrm") ?? child(node, "xfrm");
  const xfrm = own ?? child(child(inherited, "spPr"), "xfrm");
  const off = child(xfrm, "off"); const ext = child(xfrm, "ext");
  return {
    x: (transform.x + number(off, "x") * transform.scaleX) / slide.width * 100,
    y: (transform.y + number(off, "y") * transform.scaleY) / slide.height * 100,
    width: number(ext, "cx", slide.width * .6) * transform.scaleX / slide.width * 100,
    height: number(ext, "cy", slide.height * .1) * transform.scaleY / slide.height * 100,
  };
}

export async function readPresentation(file: File, onProgress?: (current: number, total: number) => void): Promise<{ metadata: PresentationMetadata; sourceFile: Blob }> {
  if (!/\.pptx$/i.test(file.name)) throw new PresentationError("Choose a .pptx file. Older .ppt, PDF, and other formats are not supported.");
  if (!file.size) throw new PresentationError("This file is empty. Choose a PowerPoint presentation with at least one slide.");
  if (file.size > MAX_FILE_BYTES) throw new PresentationError("This presentation is larger than 25 MB. Compress its images or upload a smaller deck.");
  const buffer = await file.arrayBuffer();
  validateArchive(buffer);
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buffer); }
  catch { throw new PresentationError("The presentation could not be opened. Save a fresh .pptx copy and try again."); }
  if (!zip.file("[Content_Types].xml") || !zip.file("ppt/presentation.xml")) throw new PresentationError("This archive is not a .pptx presentation.");

  const cache = new Map<string, Document>();
  const xml = async (part: string): Promise<Document | null> => {
    if (cache.has(part)) return cache.get(part)!;
    const entry = zip.file(part);
    if (!entry) return null;
    const document = parseXml(await entry.async("string"));
    cache.set(part, document); return document;
  };
  const relationships = async (part: string): Promise<Relationship[]> => {
    const paths = part.split("/"); const name = paths.pop();
    const document = await xml(`${paths.join("/")}/_rels/${name}.rels`);
    return descendants(document, "Relationship").map(rel => ({
      id: rel.getAttribute("Id") ?? "", type: rel.getAttribute("Type")?.split("/").pop() ?? "",
      part: rel.getAttribute("TargetMode") === "External" ? null : resolvePart(part, rel.getAttribute("Target") ?? ""),
    }));
  };
  const presentation = (await xml("ppt/presentation.xml"))!;
  const size = first(presentation, "sldSz");
  const dimensions = { width: number(size, "cx", 12192000), height: number(size, "cy", 6858000) };
  if (dimensions.width <= 0 || dimensions.height <= 0) throw new PresentationError("The presentation has invalid slide dimensions.");
  const rels = await relationships("ppt/presentation.xml");
  // Extension section lists can also contain sldId nodes. Only the direct
  // presentation slide list determines count and order.
  const slideIds = children(child(presentation.documentElement, "sldIdLst"), "sldId");
  if (!slideIds.length || slideIds.length > MAX_SLIDES) throw new PresentationError("Choose a presentation with between 1 and 100 slides.");
  const warnings = new Set<string>(["Preview is an approximation of the PowerPoint layout. Fonts, charts, SmartArt, animations, and some master styling may differ. Download the source to check the original."]);
  const id = crypto.randomUUID();
  const slides: SlideMetadata[] = [];
  const imageCache = new Map<string, string>();
  let imageBytes = 0; let elementCount = 0;
  for (const [index, slideId] of slideIds.entries()) {
    const relId = slideId.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? slideId.getAttribute("r:id");
    const part = rels.find(rel => rel.id === relId && rel.type === "slide")?.part;
    if (!part) throw new PresentationError(`Slide ${index + 1} is missing from the file. Save a fresh copy in PowerPoint.`);
    const document = await xml(part);
    if (!document) throw new PresentationError(`Slide ${index + 1} could not be read.`);
    const slideRels = await relationships(part);
    const layoutPart = slideRels.find(rel => rel.type === "slideLayout")?.part;
    const layout = layoutPart ? await xml(layoutPart) : null;
    const layoutRels = layoutPart ? await relationships(layoutPart) : [];
    const masterPart = layoutRels.find(rel => rel.type === "slideMaster")?.part;
    const master = masterPart ? await xml(masterPart) : null;
    const masterRels = masterPart ? await relationships(masterPart) : [];
    const themePart = masterRels.find(rel => rel.type === "theme")?.part;
    const themeDocument = themePart ? await xml(themePart) : null;
    const theme: Theme = { dk1: "#293a65", lt1: "#ffffff", accent1: "#0800b9", accent2: "#009ee3" };
    for (const entry of children(first(themeDocument, "clrScheme"))) theme[entry.localName] = color(entry, {});
    const slideTree = first(document, "spTree");
    const layoutTree = first(layout, "spTree");
    const masterTree = first(master, "spTree");
    const elements: PreviewElement[] = []; const fields: SourceField[] = [];
    const titleCandidates: { text: string; isTitle: boolean; y: number }[] = [];
    let textCount = 0; let tableCount = 0; let imageCount = 0;
    const sourceSlideId = `slide-${index + 1}`;

    async function parseTree(tree: Element | null, localRels: Relationship[], isSource: boolean, prefix: string, transform: Transform) {
      for (const node of children(tree)) {
        if (!["sp", "pic", "graphicFrame", "grpSp"].includes(node.localName)) continue;
        if (++elementCount > MAX_ELEMENTS) throw new PresentationError("This presentation has too many objects to preview. Use a smaller deck.");
        if (!isSource && placeholder(node)) continue;
        if (node.localName === "grpSp") {
          const xf = child(child(node, "grpSpPr"), "xfrm");
          const off = child(xf, "off"), ext = child(xf, "ext"), chOff = child(xf, "chOff"), chExt = child(xf, "chExt");
          const sx = number(ext, "cx", 1) / Math.max(number(chExt, "cx", 1), 1);
          const sy = number(ext, "cy", 1) / Math.max(number(chExt, "cy", 1), 1);
          await parseTree(node, localRels, isSource, prefix, {
            x: transform.x + (number(off, "x") - number(chOff, "x") * sx) * transform.scaleX,
            y: transform.y + (number(off, "y") - number(chOff, "y") * sy) * transform.scaleY,
            scaleX: transform.scaleX * sx, scaleY: transform.scaleY * sy,
          }); continue;
        }
        const inherited = matchPlaceholder(node, layoutTree) ?? matchPlaceholder(node, masterTree);
        const rect = bounds(node, inherited, dimensions, transform);
        const objectId = shapeId(node);
        const elementId = `${prefix}-${objectId}`;
        if (node.localName === "sp") {
          const body = child(node, "txBody"); const text = plainText(body);
          const properties = child(node, "spPr");
          const shapeFill = fill(properties, theme);
          const rPr = first(body, "rPr") ?? first(body, "defRPr") ?? first(inherited, "rPr");
          const pPr = first(body, "pPr");
          const phType = placeholder(node)?.getAttribute("type");
          const isTitle = ["title", "ctrTitle"].includes(phType ?? "") || /\btitle\b|^titre /i.test(first(node, "cNvPr")?.getAttribute("name") ?? "");
          elements.push({ ...rect, id: elementId, kind: text ? "text" : "shape", text,
            fill: shapeFill, color: color(child(rPr, "solidFill"), theme),
            fontSize: number(rPr, "sz", isTitle ? 2800 : 1400) / 100 / (dimensions.width / EMU_PER_POINT) * 100,
            bold: rPr?.getAttribute("b") === "1", align: pPr?.getAttribute("algn") === "ctr" ? "center" : pPr?.getAttribute("algn") === "r" ? "right" : "left",
          });
          if (isSource && (text.trim() || placeholder(node))) {
            textCount++;
            fields.push({ id: `${sourceSlideId}-shape-${objectId}`, shapeId: objectId,
              label: text.trim().replace(/\s+/g, " ").slice(0, 70) || first(node, "cNvPr")?.getAttribute("name") || "Empty text box",
              sourceText: text, location: "text-box" });
            if (text.trim() && !/^\d+$/.test(text.trim())) titleCandidates.push({ text: text.trim().replace(/\s+/g, " "), isTitle, y: rect.y });
          }
        } else if (node.localName === "pic") {
          if (isSource) imageCount++;
          const embed = first(node, "blip")?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed");
          const imagePart = localRels.find(rel => rel.id === embed && rel.type === "image")?.part;
          if (!imagePart) { warnings.add("Linked external images are not loaded. Embedded images are supported."); continue; }
          if (!/\.(png|jpe?g|gif|webp)$/i.test(imagePart)) { warnings.add("Some image formats cannot be shown in the browser preview."); continue; }
          let image = imageCache.get(imagePart);
          if (!image) {
            const entry = zip.file(imagePart);
            if (entry) {
              const bytes = await entry.async("uint8array"); imageBytes += bytes.byteLength;
              if (imageBytes > 15 * 1024 * 1024) { warnings.add("Some images were omitted to keep the preview responsive."); continue; }
              const extension = imagePart.split(".").pop()!.toLowerCase();
              image = `data:image/${extension === "jpg" ? "jpeg" : extension};base64,${await entry.async("base64")}`;
              imageCache.set(imagePart, image);
            }
          }
          if (image) elements.push({ ...rect, id: elementId, kind: "image", image });
        } else {
          const table = first(node, "tbl");
          if (!table) { if (isSource) warnings.add("Charts and SmartArt remain in the original source but are not rendered in this preview."); continue; }
          if (isSource) tableCount++;
          const rows = children(table, "tr").map((row, rowIndex) => children(row, "tc").map((cell, columnIndex) => {
            const text = plainText(child(cell, "txBody"));
            if (isSource) fields.push({ id: `${sourceSlideId}-table-${objectId}-${rowIndex}-${columnIndex}`, shapeId: objectId,
              label: text.trim().replace(/\s+/g, " ").slice(0, 70) || `Cell ${rowIndex + 1}, ${columnIndex + 1}`,
              sourceText: text, location: "table-cell", row: rowIndex, column: columnIndex });
            return text;
          }));
          const cells = children(table, "tr").map(row => children(row, "tc").map(cell => {
            const body = child(cell, "txBody"); const rPr = first(body, "rPr") ?? first(body, "defRPr");
            return { fill: fill(child(cell, "tcPr"), theme), color: color(child(rPr, "solidFill"), theme),
              fontSize: number(rPr, "sz", 1000) / 100 / (dimensions.width / EMU_PER_POINT) * 100,
              bold: rPr?.getAttribute("b") === "1", colSpan: number(cell, "gridSpan", 1), rowSpan: number(cell, "rowSpan", 1),
              hidden: cell.getAttribute("hMerge") === "1" || cell.getAttribute("vMerge") === "1" };
          }));
          elements.push({ ...rect, id: elementId, kind: "table", rows, cells,
            columnWidths: children(child(table, "tblGrid"), "gridCol").map(column => number(column, "w")),
            rowHeights: children(table, "tr").map(row => number(row, "h", 1)) });
        }
      }
    }
    const transform: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
    if (document.documentElement.getAttribute("showMasterSp") !== "0") {
      await parseTree(masterTree, masterRels, false, "master", transform);
      await parseTree(layoutTree, layoutRels, false, "layout", transform);
    }
    await parseTree(slideTree, slideRels, true, sourceSlideId, transform);
    titleCandidates.sort((a, b) => Number(b.isTitle) - Number(a.isTitle) || a.y - b.y);
    const bg = first(document, "bgPr") ?? first(layout, "bgPr") ?? first(master, "bgPr");
    const background = fill(bg, theme);
    slides.push({ id: sourceSlideId, index: index + 1, part,
      title: titleCandidates[0]?.text.slice(0, 160) || `Slide ${index + 1}`,
      layoutName: first(layout, "cSld")?.getAttribute("name") || "Unnamed layout",
      elements, fields, textCount, tableCount, imageCount,
      background: background === "transparent" ? "#ffffff" : background,
    });
    onProgress?.(index + 1, slideIds.length);
    // Allow progress paint and keep the interface responsive between slides.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  const metadata: PresentationMetadata = { id, fileName: file.name, fileSize: file.size,
    sha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join(""),
    importedAt: new Date().toISOString(), ...dimensions, slides,
    warnings: Array.from(warnings), extraction: "openxml-metadata" };
  // A file-picker File can lose its disk reference. Keep the exact bytes we parsed.
  return { metadata, sourceFile: new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }) };
}
