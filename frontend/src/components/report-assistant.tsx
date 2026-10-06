"use client";

import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { Check, Circle, FileText, KeyRound, LoaderCircle, MessageSquare, RefreshCw, Send, Upload, X } from "lucide-react";
import { agentClient } from "@/lib/agent-client";
import type { AgentSession, AgentStatus } from "@/lib/agent-contract";
import { createDefinition } from "@/lib/definition";
import { readPresentation } from "@/lib/pptx";
import { reportPlan, sourceBody, type ReportEdits } from "@/lib/report";
import { browserRepository } from "@/lib/storage";
import type { StoredPresentation } from "@/lib/types";
import { SlidePreview } from "./slide-preview";
import { ReportDeckReview } from "./report-deck-review";

const SESSION_KEY = "template-studio.agent-session";
const errorText = (error: unknown) => error instanceof Error ? error.message : "The agent could not complete this action. Try again.";

function savedSession(record?: StoredPresentation): AgentSession | null {
  if (!record?.report) return null;
  if (record.report.snapshot) return record.report.snapshot;
  // Legacy saved edits are user content, not new agent output.
  return { contractVersion: 1, sessionId: record.report.sessionId, revision: 0, status: record.report.reviewed ? "completed" : "awaiting-review", message: null, messages: [], steps: [], confirmed: {}, artifacts: [{ id: `saved-${record.id}`, kind: "content", title: "Saved executive summary", mimeType: "text/plain", reviewStatus: record.report.reviewed ? "approved" : "draft", content: Object.values(record.report.fields).join("\n\n"), fields: record.report.fields, grade: record.report.grade, reviewedGrade: record.report.grade }] };
}

export function ReportAssistant({ records, activeId, openExisting = false, fresh = false, onRecord }: { records: StoredPresentation[]; activeId: string | null; openExisting?: boolean; fresh?: boolean; onRecord: (record: StoredPresentation) => void }) {
  const [templateId, setTemplateId] = useState(activeId ?? "");
  const selected = records.find(record => record.id === templateId);
  const initialSnapshot = openExisting ? savedSession(records.find(record => record.id === activeId)) : null;
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [session, setSession] = useState<AgentSession | null>(initialSnapshot);
  const [archived, setArchived] = useState(!!initialSnapshot?.artifacts.length);
  const [reply, setReply] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [pendingAnalysis, setPendingAnalysis] = useState<string | null>(null);
  const [localEdits, setLocalEdits] = useState<ReportEdits | null>(null);
  const [reviewVisible, setReviewVisible] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pendingReply = useRef<{ text: string; key: string } | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const manualSnapshot = useRef<AgentSession | null>(null);
  const artifact = session?.artifacts.find(item => item.kind === "content");
  const plan = selected ? reportPlan(selected.metadata) : null;
  const storedEdits = selected?.report?.sessionId === session?.sessionId ? selected?.report : null;
  const edits: ReportEdits = localEdits ?? (storedEdits ? { fields: storedEdits.fields, grade: storedEdits.grade, reviewed: storedEdits.reviewed } : { fields: { ...(plan ? Object.fromEntries(plan.summaryFields.map(field => [field.id, sourceBody(field)])) : {}), ...artifact?.fields }, grade: artifact?.reviewStatus === "approved" ? artifact.reviewedGrade ?? null : artifact?.grade ?? artifact?.processRisk?.grade ?? null, reviewed: artifact?.reviewStatus === "approved" });
  const sessionId = session?.sessionId;
  const sessionStatus = session?.status;
  const showReview = !!artifact && (reviewVisible || sessionStatus === "awaiting-review" || sessionStatus === "completed");

  function saveRecord(record: StoredPresentation) {
    // A later save may recover a failed write, but each caller sees its own rejection.
    const write = saveQueue.current.catch(() => undefined).then(async () => {
      await browserRepository.put(record);
      onRecord(record);
      setStorageError(null);
    });
    saveQueue.current = write;
    void write.catch(() => setStorageError("Your latest changes could not be saved in this browser. Storage may be full or disabled. Keep this page open, download a PowerPoint copy after reviewing, then enable storage and try Save reviewed presentation again."));
    return write;
  }
  const persistSession = useEffectEvent((snapshot: AgentSession) => {
    if (!selected || selected.report?.snapshot === snapshot || manualSnapshot.current === snapshot) return;
    const record: StoredPresentation = { ...selected, report: { ...edits, sessionId: snapshot.sessionId, snapshot }, updatedAt: new Date().toISOString() };
    void saveRecord(record);
  });
  useEffect(() => { if (session) persistSession(session); }, [session]);

  useEffect(() => {
    let cancelled = false;
    heading.current?.focus();
    agentClient.capabilities().then(result => { if (!cancelled) setStatus(result); })
      .catch(error => { if (!cancelled) setError(errorText(error)); })
      .finally(() => { if (!cancelled) setChecking(false); });
    try {
      const stored = fresh || archived ? null : openExisting && selected?.report ? JSON.stringify({ sessionId: selected.report.sessionId, templateId: selected.id }) : sessionStorage.getItem(SESSION_KEY);
      if (stored) {
        const { sessionId, templateId } = JSON.parse(stored);
        agentClient.getSession(sessionId).then(result => { if (!cancelled) { setSession(result); setTemplateId(templateId); } })
          .catch(error => { if (!cancelled) {
            sessionStorage.removeItem(SESSION_KEY);
            const saved = savedSession(records.find(record => record.id === templateId));
            if (saved?.artifacts.length) { setSession(saved); setTemplateId(templateId); setArchived(true); }
            else { setSession(null); setError(errorText(error)); }
          } });
      }
    } catch { sessionStorage.removeItem(SESSION_KEY); }
    return () => { cancelled = true; };
  // These props describe the initial navigation. The shell remounts for a different audit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (sessionStatus !== "processing" || !sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const latest = await agentClient.getSession(sessionId!);
        if (cancelled) return;
        setSession(latest);
        if (latest.status === "processing") timer = setTimeout(poll, 1000);
      } catch (error) { if (!cancelled) setError(errorText(error)); }
    }
    timer = setTimeout(poll, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [sessionId, sessionStatus]);
  useEffect(() => { if (!artifact) end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [session?.messages.length, artifact]);

  async function checkConnection() {
    setChecking(true); setError(null);
    try { setStatus(await agentClient.capabilities()); if (session && !archived) setSession(await agentClient.getSession(session.sessionId)); }
    catch (error) { setError(errorText(error)); }
    finally { setChecking(false); }
  }
  async function begin(record: StoredPresentation) {
    const mapping = reportPlan(record.metadata);
    if (!mapping.summaryFields.length) { setError("No editable executive-summary area was found. Use an audit deck with a labeled Executive Summary slide and Audit conclusion area."); return; }
    setBusy(true); setError(null); setLocalEdits(null); setPendingAnalysis(null); setArchived(false);
    try {
      const result = await agentClient.start({ template: record.definition, notes: "", request: "Use the completed audit deck as evidence. Ask focused follow-up questions, confirm the process grade, and write a concise Executive Board Summary suitable for the original slide: aim for 120–150 words. Keep positive aspects and each finding/recommendation brief. Preserve factual uncertainty.", files: [], presentation: record.sourceFile, fileName: record.metadata.fileName, plan: mapping, maxRequestBytes: status?.maxRequestBytes });
      setSession(result); setTemplateId(record.id);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ sessionId: result.sessionId, templateId: record.id }));
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function configure(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    const key = apiKey; setApiKey("");
    try {
      const connection = await agentClient.configure(key); setStatus(connection); setShowSetup(false);
      if (connection.ready && pendingAnalysis && selected?.id === pendingAnalysis) await begin(selected);
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function upload(file: File) {
    setBusy(true); setError(null);
    try {
      const { metadata, sourceFile } = await readPresentation(file);
      const existing = records.find(record => record.metadata.sha256 === metadata.sha256);
      const record: StoredPresentation = existing ? { ...existing, sourceFile } : { id: metadata.id, metadata, definition: createDefinition(metadata), sourceFile, status: "saved", updatedAt: metadata.importedAt };
      await browserRepository.put(record); onRecord(record); setTemplateId(record.id); setLocalEdits(null);
      const restored = savedSession(record);
      if (restored?.artifacts.length) { setSession(restored); setArchived(true); setReviewVisible(true); setPendingAnalysis(null); }
      else if (status?.ready) await begin(record);
      else { setPendingAnalysis(record.id); setShowSetup(!!status?.canConfigure); }
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  }
  async function sendReply(event: FormEvent) {
    event.preventDefault(); if (!session || busy || !reply.trim()) return;
    setBusy(true); setError(null);
    if (pendingReply.current?.text !== reply.trim()) pendingReply.current = { text: reply.trim(), key: crypto.randomUUID() };
    try {
      setSession(await agentClient.reply({ sessionId: session.sessionId, expectedRevision: session.revision, idempotencyKey: pendingReply.current.key, reply: pendingReply.current.text }));
      setReply(""); pendingReply.current = null;
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function retry() {
    if (!session) return; setBusy(true); setError(null);
    try { setSession(await agentClient.retry(session)); }
    catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  function changeReview(next: ReportEdits) {
    if (!selected || !session) return;
    setLocalEdits(next); setReviewConfirmed(false);
    const record: StoredPresentation = { ...selected, report: { ...next, sessionId: session.sessionId, snapshot: session }, updatedAt: new Date().toISOString() };
    void saveRecord(record);
  }
  async function approve() {
    if (!session || !artifact || !selected) return; setBusy(true); setError(null);
    try {
      let result: AgentSession;
      try { result = archived ? { ...session, revision: session.revision + 1, status: "completed", artifacts: session.artifacts.map(item => item.id === artifact.id ? { ...item, fields: edits.fields, reviewedGrade: edits.grade, reviewStatus: "approved" } : item) } : await agentClient.review(session, artifact.content || "Reviewed executive summary", edits.fields, edits.grade); }
      catch (error) { setError(errorText(error)); return; }
      manualSnapshot.current = result;
      setSession(result); setReviewConfirmed(true);
      const reviewed = { ...edits, reviewed: true };
      await saveRecord({ ...selected, report: { ...reviewed, sessionId: result.sessionId, snapshot: result }, updatedAt: new Date().toISOString() });
      setLocalEdits(reviewed);
    } catch { /* saveRecord exposes an actionable storage error; local edits remain available. */ }
    finally { setBusy(false); }
  }
  function reset() {
    if (storageError && !window.confirm("Your latest changes are not saved. Download a PowerPoint copy before starting another report. Start another report anyway?")) return;
    if (!storageError && localEdits && !localEdits.reviewed && !window.confirm("Start another report? Your current presentation edits are kept in this browser, but the new conversation will replace the current chat view.")) return;
    sessionStorage.removeItem(SESSION_KEY); setSession(null); setTemplateId(""); setArchived(false); setLocalEdits(null); setReply(""); setError(null); setReviewVisible(false); setPendingAnalysis(null); setStorageError(null); setReviewConfirmed(false); manualSnapshot.current = null;
  }
  const stage = artifact ? 2 : session ? 1 : 0;
  return <>
    <input ref={fileInput} className="sr-only" type="file" accept=".pptx" aria-label="Upload completed audit presentation" onChange={event => { if (event.target.files?.[0]) void upload(event.target.files[0]); }} />
    <div className="page-heading"><div><h1 ref={heading} tabIndex={-1}>{showReview ? "Your audit presentation" : "Executive summary writer"}</h1><p>Upload your audit report. Discuss the findings. Review the completed presentation.</p></div><div className="button-row">{session ? <button className="button secondary" disabled={busy || session.status === "processing"} onClick={reset}>New report</button> : <button className="button primary" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={16} />Upload audit presentation</button>}<button className="button secondary" disabled={checking || busy} onClick={() => void checkConnection()}><RefreshCw size={15} className={checking ? "spin" : ""} />Check connection</button></div></div>
    <ol className="report-workflow" aria-label="Report progress">{["Upload audit presentation", "Discuss with the agent", "Review presentation"].map((label, i) => <li key={label} className={i === stage ? "current" : i < stage ? "complete" : ""} aria-current={i === stage ? "step" : undefined}><span>{i < stage ? <Check size={14} /> : i + 1}</span>{label}</li>)}</ol>
    {error && <div className="notice notice-error" role="alert"><span>{error}</span><button aria-label="Dismiss assistant error" onClick={() => setError(null)}><X size={16} /></button></div>}
    {storageError && <div className="notice notice-error" role="alert">{storageError}</div>}
    {archived && <div className="notice notice-info" role="status">Opened from Previous audits. Your saved summary and grade can be edited and downloaded without restarting the agent conversation.</div>}
    <div className="agent-connection" role="status"><span className={`connection-dot ${status?.connected ? "online" : ""}`} /><div><strong>{checking ? "Checking agent connection…" : status?.ready ? "Claude connected" : status?.connected ? "Connect Claude to read your report" : "Agent is offline"}</strong><p>{status?.connected ? status.ready ? "Your presentation is sent to the agent for analysis and follow-up questions." : "Upload your deck, then connect Claude to start its analysis." : status?.message || "Start the local demo to connect ESWriter to the Python agent."}</p></div>{status?.canConfigure && <button className="text-button" onClick={() => setShowSetup(previous => !previous)}><KeyRound size={15} />{status.ready ? "Reconnect Claude" : "Connect Claude"}</button>}</div>
    {showSetup && <form className="claude-setup assistant-form" onSubmit={configure}><div><h2>Connect Claude for this demo</h2><p>Your key stays in the local server’s memory. It is never saved in the browser or included in exports.</p></div><label>Anthropic API key<input type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} minLength={20} maxLength={500} required placeholder="Paste your Anthropic API key" /></label><button className="button primary" disabled={busy || apiKey.trim().length < 20}>{busy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />}Connect Claude</button></form>}
    {showReview && selected && session && plan ? <>
      <ReportDeckReview record={selected} plan={plan} session={session} edits={edits} busy={busy} unsaved={!!storageError} recoveryDownload={reviewConfirmed} onChange={changeReview} onApprove={() => void approve()} onError={setError} />
      <details className="report-conversation-history"><summary>View the agent conversation and confirmed decisions</summary><div>{session.messages.map(item => <article key={item.id} className={`chat-message chat-${item.role}`}><span>{item.role === "assistant" ? "Report assistant" : "You"}</span><p>{item.content}</p></article>)}</div></details>
    </> : <div className="assistant-layout">
      <section className="assistant-workspace" aria-label={session ? "Agent conversation" : "Upload audit report"}>
        {!session ? <div className="report-upload-content">
          {!selected ? <div className="report-upload-drop" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy && event.dataTransfer.files.length === 1) void upload(event.dataTransfer.files[0]); else setError("Upload one .pptx presentation at a time."); }}><FileText size={45} strokeWidth={1.3} /><h2>Start with your completed audit report</h2><p>Everything is filled in except the executive summary. The agent reads the presentation and asks you what it still needs.</p><button className="button primary" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? <LoaderCircle size={17} className="spin" /> : <Upload size={17} />}Upload presentation</button><p className="upload-file-note">Drop a .pptx here · Up to 25 MB</p></div> : <>
            <h2>Your report is ready to read</h2><label className="report-picker">Audit presentation<select value={selected.id} onChange={event => { setTemplateId(event.target.value); setPendingAnalysis(null); }}>{records.map(record => <option key={record.id} value={record.id}>{record.metadata.fileName}</option>)}</select></label>
            <div className="report-upload-preview"><SlidePreview slide={selected.metadata.slides.find(slide => slide.id === plan?.summarySlideId) ?? selected.metadata.slides[0]} ratio={selected.metadata.width / selected.metadata.height} /></div>
            <div className="report-ready"><div><strong>{selected.metadata.slides.length} slides · {plan?.summaryFields.length ?? 0} summary areas located</strong><p>The agent reads existing findings and management responses, then recommends a process grade. Your original file stays available.</p></div><button className="button primary" disabled={busy || !status?.ready || !plan?.summaryFields.length} onClick={() => void begin(selected)}>{busy ? <LoaderCircle size={16} className="spin" /> : <MessageSquare size={16} />}Analyze presentation</button></div>
            {!status?.ready && <p className="report-key-reminder">Connect Claude above to start the analysis. No AI recommendation has been produced yet.</p>}
          </>}
        </div> : <>
          <div className="conversation-heading"><div><h2>{session.phase === "analysis" ? "Reading your presentation" : "Discuss your audit"}</h2><p>The questions come from the agent’s review of your report.</p></div><span className="badge badge-blue">{session.status === "processing" ? "Working" : "Your turn"}</span></div>
          {session.analysis && <div className="deck-analysis-overview"><h3>What the agent found</h3><p>{session.analysis.overview}</p></div>}
          <div className="conversation-messages" aria-live="polite" aria-relevant="additions">{session.messages.map(item => <article key={item.id} className={`chat-message chat-${item.role}`}><span>{item.role === "assistant" ? "Report assistant" : "You"}</span><p>{item.content}</p></article>)}{session.status === "processing" && <div className="agent-working" role="status"><LoaderCircle size={16} className="spin" /><span>{session.phase === "analysis" ? "Reading the presentation and assessing the process grade…" : session.phase === "format" ? "Preparing the executive-summary slide…" : "The agent is working on this step…"}</span></div>}<div ref={end} /></div>
          {session.error && <div className="conversation-error" role="alert"><p>{session.error.message}</p><button className="button secondary" disabled={busy || !status?.ready} onClick={() => void retry()}><RefreshCw size={14} />Retry this step</button></div>}
          {session.status === "awaiting-input" && <form className="reply-form" onSubmit={sendReply}><label className="sr-only" htmlFor="agent-reply">Your reply to the agent</label><textarea id="agent-reply" rows={3} maxLength={20000} value={reply} onChange={event => setReply(event.target.value)} placeholder="Answer the question or ask the agent for suggestions." disabled={busy} /><div><p>You can explain the findings in your own words.</p><button className="button primary" disabled={busy || !status?.ready || !reply.trim()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}Send reply</button></div></form>}
          {artifact && <button className="button primary" onClick={() => setReviewVisible(true)}>Review presentation</button>}
        </>}
      </section>
      <aside className="assistant-context"><h2>Audit presentation</h2>{selected ? <><div className="assistant-template-preview"><SlidePreview small slide={selected.metadata.slides[0]} ratio={selected.metadata.width / selected.metadata.height} /></div><strong>{selected.metadata.fileName}</strong><p>{selected.metadata.slides.length} slides · Source retained</p></> : <p>Your uploaded report will appear here.</p>}
        <div className="assistant-progress"><h3>Preparation progress</h3>{session ? <ol>{session.steps.map(step => <li key={step.id} className={step.status}>{step.status === "confirmed" || step.status === "skipped" ? <Check size={14} /> : step.status === "current" ? <span className="current-step-dot" /> : <Circle size={13} />}<span>{step.label}{step.status === "skipped" && <small>Skipped</small>}</span></li>)}</ol> : <p>The agent reads your presentation before asking follow-up questions.</p>}</div>
        {session?.analysis && <div className="confirmed-decisions"><h3>Recommended process grade</h3><strong>{session.analysis.processRisk.grade ?? "More evidence needed"}</strong><p>{session.analysis.processRisk.rationale}</p>{session.analysis.processRisk.evidenceSlides.length > 0 && <p>Evidence: slides {session.analysis.processRisk.evidenceSlides.join(", ")}</p>}<p>You can change the grade when reviewing the presentation.</p></div>}
        {session && <div className="confirmed-decisions"><h3>Confirmed decisions</h3>{Object.keys(session.confirmed).length ? <dl>{Object.entries(session.confirmed).map(([key, value]) => <div key={key}><dt>{session.steps.find(step => step.id === key)?.label ?? key}</dt><dd>{value ?? "Skipped"}</dd></div>)}</dl> : <p>Your confirmed answers will appear here.</p>}</div>}
        <div className="assistant-scope"><FileText size={18} /><h3>One report, ready for review</h3><p>ESWriter fills the executive summary and the A–D grade box. You review both in the presentation and download an editable PowerPoint copy.</p><p>Uploaded slide text and chat replies go to Claude. Images and charts are retained but are not analyzed in this demo.</p></div>
      </aside>
    </div>}
  </>;
}
