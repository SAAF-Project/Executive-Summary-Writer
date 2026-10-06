import type { TemplateDefinition } from "./types";
import type { ProcessGrade, ReportPlan } from "./report";
export type ProcessRisk = { processName: string; grade: ProcessGrade | null; rationale: string; evidenceSlides: number[] };

/** Local HTTP adapter contract. Steps and capabilities belong to the agent. */
export type AgentStatus = {
  connected: boolean;
  ready: boolean;
  canConfigure: boolean;
  maxRequestBytes?: number;
  provider?: string;
  model?: string;
  message?: string;
  contractVersion?: 1;
  acceptedMaterialTypes?: string[];
  outputs?: Array<"content" | "presentation">;
  resumable?: boolean;
  supportsTemplateBindings?: boolean;
};
export type ConversationStart = {
  request: string;
  template: TemplateDefinition;
  notes: string;
  files: File[];
  presentation?: Blob;
  fileName?: string;
  plan?: ReportPlan;
  maxRequestBytes?: number;
};
export type ConversationReply = {
  sessionId: string;
  expectedRevision: number;
  idempotencyKey: string;
  reply: string;
};
export type AgentStep = {
  id: string;
  label: string;
  status: "pending" | "current" | "confirmed" | "skipped";
};
export type AgentArtifact = {
  id: string;
  kind: "content" | "presentation";
  title: string;
  mimeType: string;
  reviewStatus: "draft" | "approved";
  content?: string;
  confirmation?: string;
  fields?: Record<string, string>;
  processRisk?: ProcessRisk;
  reviewedGrade?: ProcessGrade | null;
  grade?: ProcessGrade | null;
  warnings?: string[];
};
export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};
export type AgentSession = {
  contractVersion: 1;
  sessionId: string;
  revision: number;
  status: "processing" | "awaiting-input" | "awaiting-review" | "completed" | "failed";
  steps: AgentStep[];
  message: string | null;
  messages: AgentMessage[];
  confirmed: Record<string, string | null>;
  artifacts: AgentArtifact[];
  error?: { code: string; message: string; retryable: boolean } | null;
  phase?: "analysis" | "interview" | "format";
  analysis?: { overview: string; firstQuestion: string; processRisk: ProcessRisk } | null;
};
export interface ConversationalAgentAdapter {
  capabilities(): Promise<AgentStatus>;
  start(input: ConversationStart): Promise<AgentSession>;
  reply(input: ConversationReply): Promise<AgentSession>;
  getSession(sessionId: string): Promise<AgentSession>;
}
