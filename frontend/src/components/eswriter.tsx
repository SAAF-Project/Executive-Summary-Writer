"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronRight, CircleHelp, FileText, History, Layers3, LoaderCircle, Monitor, Search, ShieldCheck, Sparkles, Trash2, Upload, X } from "lucide-react";
import { browserRepository } from "@/lib/storage";
import type { StoredPresentation } from "@/lib/types";
import { ReportAssistant } from "./report-assistant";

type View = "write" | "audits" | "guide";
const auditDate = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
function auditStatus(record: StoredPresentation) {
  if (record.report?.reviewed) return "Reviewed";
  if (record.report?.snapshot?.artifacts.some(item => item.kind === "content")) return "Draft ready";
  if (record.report?.snapshot) return "In progress";
  return "Uploaded";
}

export function ESWriter() {
  const [view, setView] = useState<View>("write");
  const [records, setRecords] = useState<StoredPresentation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState<{ id: string; key: number } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletedMessage, setDeletedMessage] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let cancelled = false;
    browserRepository.list().then(result => { if (!cancelled) setRecords(result); })
      .catch(error => { if (!cancelled) setError(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { heading.current?.focus(); }, [view]);
  function updateRecord(record: StoredPresentation) {
    setRecords(previous => [record, ...previous.filter(item => item.id !== record.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }
  function openAudit(record: StoredPresentation) {
    setOpening(previous => ({ id: record.id, key: (previous?.key ?? 0) + 1 }));
    setView("write");
  }
  function newAudit() { setOpening(previous => ({ id: "", key: (previous?.key ?? 0) + 1 })); setView("write"); }
  async function deleteAudit(record: StoredPresentation) {
    if (deletingId || !window.confirm(`Delete “${record.metadata.fileName}”? This removes its presentation, saved summary, and chat history from this browser. This cannot be undone. Your original file is kept.`)) return;
    setDeletingId(record.id);
    setDeletedMessage(null);
    try {
      await browserRepository.remove(record.id);
      setRecords(previous => previous.filter(item => item.id !== record.id));
      setOpening(previous => previous?.id === record.id ? { id: "", key: previous.key + 1 } : previous);
      try {
        const saved = JSON.parse(sessionStorage.getItem("template-studio.agent-session") ?? "null");
        if (saved?.templateId === record.id) sessionStorage.removeItem("template-studio.agent-session");
      } catch { /* History deletion succeeds even when session storage is unavailable. */ }
      setError(null);
      setDeletedMessage(`Deleted ${record.metadata.fileName}.`);
      heading.current?.focus();
    } catch { setError("This audit could not be deleted. It is still available. Enable browser storage and try again."); }
    finally { setDeletingId(null); }
  }
  const visible = records.filter(record => record.metadata.fileName.toLowerCase().includes(query.toLowerCase()));
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className="sidebar">
      <button className="brand" onClick={() => setView("write")} aria-label="ESWriter home"><span className="brand-icon"><Layers3 size={23} /></span><span>ES<span className="brand-light">Writer</span></span></button>
      <div className="workspace-label"><span className="workspace-dot" />Internal Audit<span className="workspace-abbreviation">IA</span></div>
      <nav aria-label="Main navigation">
        <button className={`nav-item ${view === "write" ? "selected" : ""}`} onClick={() => setView("write")} aria-current={view === "write" ? "page" : undefined}><Sparkles size={18} />Write summary</button>
        <button className={`nav-item ${view === "audits" ? "selected" : ""}`} onClick={() => setView("audits")} aria-current={view === "audits" ? "page" : undefined}><History size={18} />Previous audits<span className="nav-count">{records.length}</span></button>
      </nav>
      <div className="sidebar-bottom"><div className="local-note"><ShieldCheck size={20} /><strong>Your browser. Your files.</strong><p>Reports and saved summaries stay in this browser. Report text goes to Claude when you analyze.</p></div><button className={`nav-item ${view === "guide" ? "selected" : ""}`} onClick={() => setView("guide")}><CircleHelp size={18} />How it works</button><div className="sidebar-footer">Internal Audit<span>Executive summaries · Demo</span></div></div>
    </aside>
    <div className="app-body">
      <header className="topbar"><div className="breadcrumb"><span>Internal audit</span><ChevronRight size={14} /><span>{view === "write" ? "Write summary" : view === "audits" ? "Previous audits" : "How it works"}</span></div><span className="local-workspace"><Monitor size={14} />Browser workspace</span></header>
      <main id="main-content" className="main-content">
        {error && <div className="notice notice-error" role="alert"><span>{error}</span><button aria-label="Dismiss workspace error" onClick={() => setError(null)}><X size={16} /></button></div>}
        {loading ? <div className="import-progress" role="status"><LoaderCircle className="spin" size={18} />Opening your workspace…</div> : view === "write" ? <ReportAssistant key={opening?.key ?? "current"} records={records} activeId={opening?.id ?? null} openExisting={!!opening?.id} fresh={opening?.id === ""} onRecord={updateRecord} /> : view === "audits" ? <>
          <div className="page-heading"><div><h1 ref={heading} tabIndex={-1}>Previous audits</h1><p>Reopen your uploaded reports and saved executive summaries.</p></div><button className="button primary" onClick={newAudit}><Upload size={16} />New audit</button></div>
          <p className="audit-storage-note">Saved in this browser. Use the same browser and device to return to these reports.</p>{deletedMessage && <p className="audit-delete-status" role="status">{deletedMessage}</p>}
          {records.length ? <><label className="audit-search"><Search size={17} /><span className="sr-only">Search previous audits</span><input type="search" placeholder="Search by presentation name" value={query} onChange={event => setQuery(event.target.value)} /></label><div className="audit-list" aria-label="Saved audit reports"><div className="audit-list-heading" aria-hidden="true"><span>Presentation</span><span>Status</span><span>Grade</span><span>Last updated</span><span /></div>{visible.map(record => <article className="audit-list-row" key={record.id}><div className="audit-title"><FileText size={22} /><div><h2>{record.metadata.fileName.replace(/\.pptx$/i, "")}</h2><p>{record.metadata.slides.length} slides · {(record.metadata.fileSize / 1024 / 1024).toFixed(1)} MB</p></div></div><span className={`badge ${record.report?.reviewed ? "badge-green" : "badge-neutral"}`}>{auditStatus(record)}</span><span className="audit-grade">{record.report?.grade ? `Grade ${record.report.grade}` : "Not graded"}</span><time dateTime={record.updatedAt}>{auditDate(record.updatedAt)}</time><div className="audit-row-actions"><button className="button secondary" disabled={!!deletingId} aria-label={`Open audit ${record.metadata.fileName}`} onClick={() => openAudit(record)}>Open audit<ArrowRight size={15} /></button><button className="icon-button audit-delete-button" disabled={!!deletingId} aria-label={`Delete audit ${record.metadata.fileName}`} title="Delete audit" onClick={() => void deleteAudit(record)}>{deletingId === record.id ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}</button></div></article>)}</div>{!visible.length && <p className="audit-no-results" role="status">No audits match “{query}”. Try another presentation name.</p>}</> : <div className="audit-empty"><History size={36} strokeWidth={1.4} /><h2>Your audit history starts here</h2><p>Uploaded reports will appear here, along with their saved summaries and process grades.</p><button className="button primary" onClick={newAudit}><Upload size={16} />Start an audit</button></div>}
        </> : <><div className="page-heading"><div><h1 ref={heading} tabIndex={-1}>How it works</h1><p>From your completed audit report to a reviewed executive summary.</p></div></div><div className="guide-layout"><div className="guide-steps">{[["Upload your audit report", "Choose the .pptx with the audit evidence already filled in. ESWriter reads its slide text, tables and notes."], ["Discuss with the agent", "Claude reads the report, asks for missing evidence, and recommends an A–D process grade."], ["Review and download", "Browse the presentation, edit the executive summary, choose the process grade, save your review, and download PowerPoint."], ["Return to a previous audit", "Your reports and saved summaries appear in Previous audits in this browser. Reviewed summaries can be reopened even after the agent restarts."]].map(([title, description], index) => <section key={title}><span>{index + 1}</span><div><h2>{title}</h2><p>{description}</p></div></section>)}</div><aside className="guide-aside"><ShieldCheck size={26} /><h2>Your report workspace</h2><p>Original presentation bytes and saved review edits stay in this browser. Uploaded report text and conversation replies are sent to Claude during analysis.</p><p>The preview is approximate. Download and check the PowerPoint before sharing the final report.</p><button className="button primary" onClick={newAudit}><Upload size={16} />Start an audit</button></aside></div></>}
      </main>
    </div>
  </div>;
}
