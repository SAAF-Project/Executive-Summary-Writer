import type { PresentationMetadata, TemplateDefinition } from "./types";

/** Future decoder accepts source metadata and returns an interpretation for human review. */
export interface TemplateDecoder {
  interpret(source: PresentationMetadata): Promise<TemplateDefinition>;
}
/** Future agent receives both the immutable source and its reviewed definition. */
export interface GenerationAgent {
  generate(request: { sourceFile: Blob; definition: TemplateDefinition }): Promise<{ jobId: string }>;
}
export const integrationStatus = { decoder: "not-connected", agent: "not-connected" } as const;
// Deliberately no network implementation or synthetic AI result in this phase.
