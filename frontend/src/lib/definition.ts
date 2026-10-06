import { DEFINITION_VERSION, type PresentationMetadata, type TemplateDefinition } from "./types";

export function createDefinition(metadata: PresentationMetadata): TemplateDefinition {
  const now = new Date().toISOString();
  return {
    schemaVersion: DEFINITION_VERSION, id: crypto.randomUUID(),
    name: metadata.fileName.replace(/\.pptx$/i, ""), description: "",
    source: { presentationId: metadata.id, fileName: metadata.fileName, sha256: metadata.sha256 },
    slides: metadata.slides.map(slide => ({
      id: slide.id, sourceSlideId: slide.id, title: slide.title,
      section: "Unassigned", instructions: "",
      fields: slide.fields.map(field => ({
        id: field.id, source: field, label: field.label,
        key: `slide_${slide.index}_field_${field.id.replace(/[^a-z0-9]/gi, "_")}`,
        type: "text", enabled: false, required: false, instructions: "",
      })),
    })),
    decoder: { status: "not-connected", provenance: "deterministic" },
    createdAt: now, updatedAt: now,
  };
}

export function validateDefinition(definition: TemplateDefinition): string | null {
  if (!definition.name.trim()) return "Give your template a name before saving.";
  const keys = new Set<string>();
  for (const slide of definition.slides) {
    if (!slide.title.trim()) return "Each slide needs a title before saving.";
    for (const field of slide.fields.filter(field => field.enabled)) {
      if (!field.label.trim()) return `Add a label for every enabled field on “${slide.title}”.`;
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field.key)) return "Field keys must start with a letter and contain only letters, numbers, and underscores.";
      if (keys.has(field.key)) return `The field key “${field.key}” is used twice. Give each enabled field a unique key.`;
      keys.add(field.key);
    }
  }
  return null;
}
