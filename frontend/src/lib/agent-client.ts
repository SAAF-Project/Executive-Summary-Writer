import type { AgentSession, AgentStatus, ConversationReply, ConversationStart, ConversationalAgentAdapter } from "./agent-contract";
import type { ProcessGrade } from "./report";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/agent/${path}`, { ...init, cache: "no-store" });
  let body;
  try { body = await response.json(); }
  catch { throw new Error(response.status === 413 ? "This presentation is too large for the hosted demo. Use a smaller .pptx (about 3 MB or less)." : "The agent returned an unreadable response. Check the connection and retry."); }
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "The agent could not process this request. Try again.");
  return body as T;
}
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const agentClient: ConversationalAgentAdapter & {
  configure(apiKey: string): Promise<AgentStatus>;
  retry(session: AgentSession): Promise<AgentSession>;
  review(session: AgentSession, content: string, fields?: Record<string, string>, grade?: ProcessGrade | null): Promise<AgentSession>;
} = {
  capabilities: () => call("status"),
  configure: apiKey => call("configuration", json({ apiKey })),
  async start(input: ConversationStart) {
    const body = new FormData();
    body.append("template", JSON.stringify(input.template));
    body.append("request", input.request);
    body.append("notes", input.notes);
    input.files.forEach(file => body.append("files", file));
    if (input.presentation) body.append("presentation", input.presentation, input.fileName || "audit-report.pptx");
    if (input.plan) body.append("plan", JSON.stringify(input.plan));
    if (input.maxRequestBytes) {
      const encoded = new Response(body);
      const bytes = await encoded.arrayBuffer();
      if (bytes.byteLength > input.maxRequestBytes) throw new Error("This presentation and its extracted content are too large for the hosted demo. Use a smaller .pptx (about 3 MB or less).");
      return call<AgentSession>("sessions", { method: "POST", headers: { "Content-Type": encoded.headers.get("Content-Type")! }, body: bytes });
    }
    return call("sessions", { method: "POST", body });
  },
  reply: (input: ConversationReply) => call(`sessions/${encodeURIComponent(input.sessionId)}/reply`, json({ expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey, reply: input.reply })),
  getSession: sessionId => call(`sessions/${encodeURIComponent(sessionId)}`),
  retry: session => call(`sessions/${encodeURIComponent(session.sessionId)}/retry`, json({ expectedRevision: session.revision })),
  review: (session, content, fields, grade) => call(`sessions/${encodeURIComponent(session.sessionId)}/review`, json({ expectedRevision: session.revision, content, ...(fields ? { fields, grade } : {}) })),
};
