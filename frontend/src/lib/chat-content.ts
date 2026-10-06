export type ChatQuestion = { text: string; options: string[]; number?: number };
export type ChatContent = { before: string; questions: ChatQuestion[]; after: string };
const empty = (text: string): ChatContent => ({ before: text, questions: [], after: "" });
const questionLike = (text: string) => /[?？]/.test(text) || /^(?:\*\*)?(?:Q(?:uestion)?\s*\d+\s*[:.)])/i.test(text);

function optionText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const known = ["label", "text", "description", "value", "context", "hint", "detail", "rationale"];
  if (Object.keys(item).some(key => !known.includes(key)) || Object.values(item).some(part => typeof part !== "string")) return null;
  const text = item.text ?? item.description ?? item.label ?? item.value;
  if (typeof text !== "string") return null;
  const label = typeof item.label === "string" && item.label !== text ? item.label : typeof item.value === "string" && item.value !== text ? item.value : null;
  const details = [...new Set(known.map(key => item[key]).filter((part): part is string => typeof part === "string" && part !== text && part !== label))];
  return [label ? `${label}: ${text}` : text, ...details].join("\n\n");
}
function structured(value: unknown): ChatContent | null {
  const root = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const items = Array.isArray(value) ? value : root?.questions;
  if (!Array.isArray(items) || !items.length) return null;
  // Unknown fields are left visible in the original message rather than silently dropped.
  if (root && Object.keys(root).some(key => !["questions", "intro", "introduction", "context", "message", "instructions", "closing"].includes(key))) return null;
  const questions: ChatQuestion[] = [];
  for (const item of items) {
    if (typeof item === "string" && item.trim()) { questions.push({ text: item, options: [] }); continue; }
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some(key => !["question", "text", "prompt", "context", "description", "hint", "options", "choices", "label", "id"].includes(key))) return null;
    const text = row.question ?? row.prompt ?? row.text;
    if (typeof text !== "string" || !text.trim()) return null;
    const details = [row.context, row.description, row.hint].filter((part): part is string => typeof part === "string");
    const values = row.options ?? row.choices ?? [];
    if (!Array.isArray(values)) return null;
    const options = values.map(optionText);
    if (options.some(option => option === null)) return null;
    const label = typeof row.label === "string" ? `${row.label}\n\n` : "";
    questions.push({ text: [label + text, ...details].join("\n\n"), options: options as string[], number: typeof row.id === "number" && Number.isInteger(row.id) && row.id > 0 ? row.id : undefined });
  }
  const words = (keys: string[]) => keys.map(key => root?.[key]).filter((part): part is string => typeof part === "string").join("\n\n");
  if (root && Object.values(root).some(part => part !== items && typeof part !== "string")) return null;
  return { before: words(["intro", "introduction", "context", "message"]), questions, after: words(["instructions", "closing"]) };
}

/** Presentation only: retain the original agent message and reply contract. */
export function normalizeChatContent(content: unknown): ChatContent {
  if (typeof content !== "string") return structured(content) ?? empty(JSON.stringify(content, null, 2) ?? "");
  const source = content.replace(/\r\n?/g, "\n").trim();
  try { const result = structured(JSON.parse(source)); if (result) return result; } catch { /* Ordinary agent prose. */ }
  const fence = source.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  if (fence) {
    try {
      const result = structured(JSON.parse(fence[1]));
      if (result) return { ...result, before: [source.slice(0, fence.index).trim(), result.before].filter(Boolean).join("\n\n"), after: [result.after, source.slice((fence.index ?? 0) + fence[0].length).trim()].filter(Boolean).join("\n\n") };
    } catch { /* Preserve unfamiliar or malformed content as readable prose. */ }
  }
  const lines = source.split("\n");
  const starts: Array<{ line: number; text: string; number?: number }> = [];
  const codeLines = new Set<number>();
  let fenceMarker: { character: string; length: number } | null = null;
  lines.forEach((line, index) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMarker) {
      codeLines.add(index);
      if (marker && marker[1][0] === fenceMarker.character && marker[1].length >= fenceMarker.length) fenceMarker = null;
      return;
    }
    if (marker) { codeLines.add(index); fenceMarker = { character: marker[1][0], length: marker[1].length }; return; }
    const match = line.match(/^ {0,2}(?:(\d+)[.):]|\((\d+)\)|\[(\d+)\]|[-*+•●▪])\s+(.+)$/);
    if (match && questionLike(match[4])) starts.push({ line: index, text: match[4], number: match[1] || match[2] || match[3] ? Number(match[1] || match[2] || match[3]) : undefined });
  });
  // Also handle plain question-per-line output without guessing where sentences split.
  if (!starts.length) lines.forEach((line, index) => {
    if (codeLines.has(index)) return;
    if (questionLike(line) && /[?？](?:\*\*)?\s*$/.test(line.trim())) starts.push({ line: index, text: line.trim() });
  });
  if (starts.length < 2) return empty(source);
  let tail = lines.length;
  const last = starts[starts.length - 1].line;
  // A separate closing paragraph remains outside the question list.
  for (let index = last + 1; index < lines.length - 1; index++) {
    if (!lines[index].trim() && lines[index + 1].trim() && !/^\s*(?:[-*+•●▪]|\d+[.):]|\|)/.test(lines[index + 1])) { tail = index; break; }
  }
  return {
    before: lines.slice(0, starts[0].line).join("\n").trim(),
    questions: starts.map((item, index) => ({ text: [item.text, ...lines.slice(item.line + 1, starts[index + 1]?.line ?? tail)].join("\n").trim(), number: item.number, options: [] })),
    after: lines.slice(tail).join("\n").trim(),
  };
}
