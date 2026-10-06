export const DEFINITION_VERSION = 1 as const;
export type FieldType = "text" | "long-text" | "number" | "date";
export type Rect = { x: number; y: number; width: number; height: number };
export type PreviewElement = Rect & {
  id: string; kind: "text" | "shape" | "image" | "table";
  text?: string; fontSize?: number; color?: string; fill?: string;
  bold?: boolean; align?: "left" | "center" | "right"; image?: string;
  rows?: string[][];
  columnWidths?: number[]; rowHeights?: number[];
  cells?: { fill: string; color: string; fontSize: number; bold: boolean; colSpan: number; rowSpan: number; hidden: boolean }[][];
};
export type SourceField = {
  id: string; shapeId: string; label: string; sourceText: string;
  location: "text-box" | "table-cell"; row?: number; column?: number;
};
export type SlideMetadata = {
  id: string; index: number; part: string; title: string; layoutName: string;
  elements: PreviewElement[]; fields: SourceField[];
  textCount: number; tableCount: number; imageCount: number;
  background: string;
};
export type PresentationMetadata = {
  id: string; fileName: string; fileSize: number; sha256: string;
  importedAt: string; width: number; height: number; slides: SlideMetadata[];
  warnings: string[]; extraction: "openxml-metadata";
};
export type TemplateField = {
  id: string; source: SourceField | null; label: string; key: string;
  type: FieldType; enabled: boolean; required: boolean; instructions: string;
};
export type TemplateSlide = {
  id: string; sourceSlideId: string; title: string; section: string;
  instructions: string; fields: TemplateField[];
};
export type TemplateDefinition = {
  schemaVersion: typeof DEFINITION_VERSION;
  id: string; name: string; description: string;
  source: { presentationId: string; fileName: string; sha256: string };
  slides: TemplateSlide[]; decoder: { status: "not-connected"; provenance: "deterministic" };
  createdAt: string; updatedAt: string;
};
export type StoredPresentation = {
  id: string; metadata: PresentationMetadata; definition: TemplateDefinition;
  sourceFile: Blob; status: "draft" | "saved"; updatedAt: string;
  report?: { sessionId: string; fields: Record<string, string>; grade: "A" | "B" | "C" | "D" | null; reviewed: boolean; snapshot?: import("./agent-contract").AgentSession };
};
export const SECTIONS = ["Unassigned", "Cover", "Table of contents", "Introduction", "Executive summary", "Process dashboard", "Finding overview", "Findings and recommendations", "Appendices"];
