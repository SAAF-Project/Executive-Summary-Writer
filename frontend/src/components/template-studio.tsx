"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, FileText, FolderOpen, Layers3, LayoutGrid, LoaderCircle, LockKeyhole, Monitor, Plus, Search, Settings2, ShieldCheck, Sparkles, Trash2, Upload, X } from "lucide-react";
import { readPresentation, PresentationError } from "@/lib/pptx";
import { createDefinition, validateDefinition } from "@/lib/definition";
import { browserRepository } from "@/lib/storage";
import { REFERENCE_SECTIONS, REFERENCE_SLIDES } from "@/lib/reference";
import { SECTIONS, type StoredPresentation, type TemplateDefinition, type TemplateField, type TemplateSlide } from "@/lib/types";
import { ReferencePreview, SlidePreview } from "./slide-preview";
import { ReportAssistant } from "./report-assistant";

type View = "dashboard" | "editor" | "saved" | "reference" | "guide" | "integrations";
type Message = { kind: "error" | "success" | "info"; text: string };
const fileSize = (size: number) => `${(size / 1024 / 1024).toFixed(1)} MB`;
const date = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportDefinition(definition: TemplateDefinition) {
  download(new Blob([JSON.stringify(definition, null, 2)], { type: "application/json" }), `${definition.name.replace(/[^a-z0-9\-_ ]/gi, "").slice(0, 100) || "template"}.template.json`);
}
function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "blue" | "green" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
function Workflow({ step = 0 }: { step?: number }) {
  return <ol className="workflow" aria-label="Template setup progress">
    {["Upload presentation", "Review interpretation", "Save template", "Fill presentation"].map((label, index) =>
      <li key={label} className={`${index < step ? "complete" : ""} ${index === step ? "current" : ""} ${index === 3 ? "future" : ""}`} aria-current={index === step ? "step" : undefined}>
        <span className="step-marker">{index < step ? <Check size={13} /> : index === 3 ? <LockKeyhole size={12} /> : index + 1}</span>
        <span>{label}{index === 3 && <small>Coming later</small>}</span>{index < 3 && <ChevronRight className="step-chevron" size={15} />}
      </li>)}
  </ol>;
}

export function TemplateStudio() {
  const [view, setView] = useState<View>("integrations");
  const [records, setRecords] = useState<StoredPresentation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [definition, setDefinition] = useState<TemplateDefinition | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [message, setMessage] = useState<Message | null>(null);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const uploading = useRef(false);
  const active = records.find(record => record.id === activeId);

  useEffect(() => {
    let cancelled = false;
    browserRepository.list().then(result => { if (!cancelled) setRecords(result); })
      .catch(error => { if (!cancelled) setMessage({ kind: "error", text: error.message }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => { heading.current?.focus(); }, [view]);

  const canLeave = () => !dirty || window.confirm("You have unsaved interpretation changes. Leave without saving them?");
  function navigate(next: View) {
    if (!canLeave()) return;
    setDirty(false); setView(next); setMessage(null);
  }
  function chooseFile() {
    if (busy || loading || !canLeave()) return;
    input.current?.click();
  }
  async function importFile(file: File) {
    if (uploading.current || !canLeave()) return;
    uploading.current = true; setBusy(true); setMessage(null); setProgress({ current: 0, total: 0 });
    try {
      const { metadata, sourceFile } = await readPresentation(file, (current, total) => setProgress({ current, total }));
      const existing = records.find(record => record.metadata.sha256 === metadata.sha256);
      if (existing) {
        const repaired = { ...existing, sourceFile };
        await browserRepository.put(repaired);
        setRecords(previous => previous.map(record => record.id === repaired.id ? repaired : record));
        setActiveId(existing.id); setDefinition(structuredClone(existing.definition)); setView("editor"); setDirty(false);
        setMessage({ kind: "info", text: "This presentation is already in your workspace. Your existing template has been opened." });
        return;
      }
      const template = createDefinition(metadata);
      const record: StoredPresentation = { id: metadata.id, metadata, definition: template, sourceFile, status: "draft", updatedAt: metadata.importedAt };
      let storageMessage: Message | null = null;
      try { await browserRepository.put(record); }
      catch (error) { storageMessage = { kind: "error", text: `${(error as Error).message} The presentation is available in this session.` }; }
      setRecords(previous => [record, ...previous]); setActiveId(record.id); setDefinition(template); setDirty(false); setView("editor");
      setMessage(storageMessage ?? { kind: "success", text: `${metadata.slides.length} slides imported. Review the file structure and select your editable fields.` });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof PresentationError ? error.message : "We couldn’t read this presentation. Save a fresh .pptx copy and try again." });
    } finally { uploading.current = false; setBusy(false); if (input.current) input.current.value = ""; }
  }
  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (files?.[0]) void importFile(files[0]);
  }
  function drop(event: DragEvent) {
    event.preventDefault(); setDragging(false);
    if (event.dataTransfer.files.length !== 1) { setMessage({ kind: "error", text: "Upload one presentation at a time." }); return; }
    void importFile(event.dataTransfer.files[0]);
  }
  function edit(record: StoredPresentation) {
    if (!canLeave()) return;
    setActiveId(record.id); setDefinition(structuredClone(record.definition)); setDirty(false); setView("editor"); setMessage(null);
  }
  function update(next: TemplateDefinition) { setDefinition(next); setDirty(true); }
  async function save() {
    if (!active || !definition || saving) return;
    const invalid = validateDefinition(definition);
    if (invalid) { setMessage({ kind: "error", text: invalid }); return; }
    setSaving(true); setMessage(null);
    const now = new Date().toISOString();
    const finalDefinition = { ...definition, name: definition.name.trim(), updatedAt: now };
    const record: StoredPresentation = { ...active, definition: finalDefinition, status: "saved", updatedAt: now };
    try {
      await browserRepository.put(record);
      setRecords(previous => previous.map(item => item.id === record.id ? record : item));
      setDefinition(finalDefinition); setDirty(false); setView("saved");
    } catch (error) { setMessage({ kind: "error", text: (error as Error).message }); }
    finally { setSaving(false); }
  }
  async function remove(record: StoredPresentation) {
    try { await browserRepository.remove(record.id); setRecords(previous => previous.filter(item => item.id !== record.id)); setDeleteId(null); }
    catch (error) { setMessage({ kind: "error", text: (error as Error).message }); }
  }
  const visibleRecords = records.filter(record => (filter === "all" || record.status === filter) && record.definition.name.toLowerCase().includes(query.toLowerCase()));

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <input ref={input} id="presentation-upload" className="sr-only" type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={handleInput} aria-label="Upload PowerPoint presentation" disabled={busy} />
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate("integrations")} aria-label="ESWriter home"><span className="brand-icon"><Layers3 size={23} /></span><span>ES<span className="brand-light">Writer</span></span></button>
      <div className="workspace-label"><span className="workspace-dot" />Internal Audit<span className="workspace-abbreviation">IA</span></div>
      <nav aria-label="Main navigation">
        <button className={view === "dashboard" || view === "editor" || view === "saved" || view === "reference" ? "nav-item selected" : "nav-item"} onClick={() => navigate("dashboard")}><LayoutGrid size={18} />Templates<span className="nav-count">{records.length}</span></button>
        <button className={view === "integrations" ? "nav-item selected" : "nav-item"} onClick={() => navigate("integrations")}><Sparkles size={18} />Write summary</button>
      </nav>
      <div className="sidebar-bottom">
        <div className="local-note"><ShieldCheck size={20} /><strong>Your browser. Your files.</strong><p>Original files stay here. Report text is shared with Claude when you analyze.</p></div>
        <button className={view === "guide" ? "nav-item selected" : "nav-item"} onClick={() => navigate("guide")}><CircleHelp size={18} />How it works</button>
        <div className="sidebar-footer">Internal Audit<span>Executive summaries · Demo</span></div>
      </div>
    </aside>
    <div className="app-body">
      <header className="topbar"><div className="breadcrumb"><span>Internal audit</span><ChevronRight size={14} /><span>{view === "integrations" ? "Report assistant" : view === "guide" ? "How it works" : "Templates"}</span>{active && ["editor", "saved"].includes(view) && <><ChevronRight size={14} /><strong>{definition?.name}</strong></>}</div><span className="local-workspace"><Monitor size={14} />Local workspace</span></header>
      <main id="main-content" className={`main-content ${view === "editor" ? "editor-main" : ""}`}>
        {message && <div className={`notice notice-${message.kind}`} role={message.kind === "error" ? "alert" : "status"}><span>{message.text}</span><button aria-label="Dismiss message" onClick={() => setMessage(null)}><X size={16} /></button></div>}
        {busy && <div className="import-progress" role="status" aria-live="polite"><LoaderCircle className="spin" size={18} /><span>Reading presentation{progress.total > 0 ? ` · ${progress.current} of ${progress.total} slides` : "…"}</span><progress value={progress.current} max={progress.total || 1} /></div>}
        {view === "dashboard" && <>
          <div className="page-heading"><div><h1 ref={heading} tabIndex={-1}>Presentation templates</h1><p>A familiar report. A reusable starting point.</p></div><button className="button primary" onClick={chooseFile} disabled={busy || loading}><Plus size={17} />Upload presentation</button></div>
          <Workflow />
          <div className="dashboard-feature">
            <section className={`upload-panel ${dragging ? "dragging" : ""}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop} aria-labelledby="upload-heading">
              <div className="upload-visual"><div className="paper-back" /><div className="paper-front"><FileText size={35} strokeWidth={1.4} /><span>PPTX</span></div><span className="upload-round"><Upload size={18} /></span></div>
              <h2 id="upload-heading">Start with your presentation</h2><p>Upload a PowerPoint deck, review its structure,<br className="desktop-break" /> and make it your template.</p>
              <button className="button primary" onClick={chooseFile} disabled={busy || loading}><Upload size={16} />Choose a presentation</button>
              <span className="drop-copy">or drag and drop it here</span><span className="file-limit">.pptx format · Up to 25 MB · 100 slides</span>
            </section>
            <section className="reference-panel" aria-labelledby="reference-heading"><h2 id="reference-heading">One report. A clear structure.</h2><p>The supplied AFKL reference deck has 13 slides across six core audit sections.</p><div className="reference-list">{REFERENCE_SECTIONS.map(section => <div key={section.name}><span>{section.name}</span><span>{section.slides}</span></div>)}</div><button className="text-button" onClick={() => navigate("reference")}>Explore reference outline<ArrowRight size={16} /></button></section>
          </div>
          <section className="template-library" aria-labelledby="library-heading"><div className="library-heading"><h2 id="library-heading">Your templates <span>{records.length}</span></h2><div className="library-controls"><div className="segmented" aria-label="Filter templates">{[{ id: "all", label: "All" }, { id: "saved", label: "Saved" }, { id: "draft", label: "Drafts" }].map(item => <button key={item.id} aria-pressed={filter === item.id} className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div><label className="search-box"><Search size={15} /><input aria-label="Search templates" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search templates" /></label></div></div>
            {loading ? <div className="empty-library" role="status"><LoaderCircle className="spin" size={22} /><span>Opening your workspace…</span></div> : visibleRecords.length ? <div className="template-grid">{visibleRecords.map(record => <article className="template-card" key={record.id}><button className="template-open" onClick={() => edit(record)}><div className="template-thumbnail"><SlidePreview small slide={record.metadata.slides[0]} ratio={record.metadata.width / record.metadata.height} /><Badge tone={record.status === "saved" ? "green" : "neutral"}>{record.status === "saved" ? "Saved" : "Draft"}</Badge></div><div className="template-card-copy"><h3>{record.definition.name}</h3><p>{record.metadata.slides.length} slides<span>Updated {date(record.updatedAt)}</span></p></div></button><div className="template-card-footer"><button className="text-button" onClick={() => edit(record)}>Open template<ArrowRight size={14} /></button>{deleteId === record.id ? <div className="delete-actions"><button className="danger-text" onClick={() => void remove(record)}>Delete</button><button onClick={() => setDeleteId(null)}>Cancel</button></div> : <button className="icon-button" aria-label={`Delete ${record.definition.name}`} onClick={() => setDeleteId(record.id)}><Trash2 size={15} /></button>}</div></article>)}</div> : <div className="empty-library"><span className="empty-icon"><FolderOpen size={27} strokeWidth={1.4} /></span><div><h3>{records.length ? "No matching templates" : "Your template library starts here"}</h3><p>{records.length ? "Try another search or filter." : "Upload a presentation to add your first template. Saved templates will appear here."}</p></div>{records.length > 0 && <button className="text-button" onClick={() => { setFilter("all"); setQuery(""); }}>Clear filters</button>}</div>}
          </section>
          <p className="dashboard-footnote"><LockKeyhole size={13} />Files and template definitions are stored in this browser. Export a definition to keep a portable copy.</p>
        </>}
        {view === "editor" && active && definition && <>
          <div className="page-heading editor-heading"><div><button className="back-link" onClick={() => navigate("dashboard")}><ArrowLeft size={15} />Templates</button><h1 ref={heading} tabIndex={-1}>Review your template</h1><p>Check the source structure and define what can change.</p></div><div className="editor-actions"><span className="save-state">{dirty ? "Unsaved changes" : active.status === "saved" ? "Saved template" : "Draft"}</span><button className="button primary" onClick={() => void save()} disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{saving ? "Saving…" : "Save template"}</button></div></div>
          <Workflow step={1} />
          <TemplateEditor key={active.id} record={active} definition={definition} onChange={update} onExport={() => exportDefinition(definition)} />
        </>}
        {view === "saved" && active && definition && <>
          <button className="back-link" onClick={() => navigate("dashboard")}><ArrowLeft size={15} />All templates</button>
          <div className="saved-heading"><span className="saved-icon"><CheckCircle2 size={30} /></span><h1 ref={heading} tabIndex={-1}>Your template is ready</h1><p>The source presentation and your reviewed definition are saved in this browser.</p></div><Workflow step={3} />
          <div className="saved-layout"><section className="saved-summary"><div className="saved-preview"><SlidePreview slide={active.metadata.slides[0]} ratio={active.metadata.width / active.metadata.height} /></div><div className="saved-summary-copy"><Badge tone="green">Saved template</Badge><h2>{definition.name}</h2>{definition.description && <p>{definition.description}</p>}<dl className="summary-facts"><div><dt>Source presentation</dt><dd>{active.metadata.fileName}</dd></div><div><dt>Template structure</dt><dd>{definition.slides.length} slides · {definition.slides.flatMap(slide => slide.fields).filter(field => field.enabled).length} editable fields</dd></div><div><dt>Saved</dt><dd>{date(definition.updatedAt)}</dd></div></dl><div className="button-row"><button className="button secondary" onClick={() => edit(active)}><Settings2 size={16} />Edit interpretation</button><button className="button secondary" onClick={() => exportDefinition(definition)}><ArrowDownToLine size={16} />Export definition</button></div></div></section><section className="agent-panel"><span className="agent-icon"><Sparkles size={25} /></span><h2>From template to report</h2><p>Use your saved template alongside a guided audit-writing conversation.</p><div className="agent-status"><span className="status-dot" />PowerPoint filling comes later</div><button className="button primary" onClick={() => navigate("integrations")}><Sparkles size={15} />Open report assistant</button><button className="button secondary" disabled title="The current agent writes a summary. PowerPoint filling comes later."><LockKeyhole size={15} />Generate PowerPoint</button><p className="agent-small">Review the agent’s draft in Report assistant. Your source presentation stays unchanged.</p></section></div>
        </>}
        {view === "reference" && <>
          <button className="back-link" onClick={() => navigate("dashboard")}><ArrowLeft size={15} />All templates</button><div className="page-heading"><div><h1 ref={heading} tabIndex={-1}>AFKL audit report outline</h1><p>13 slides from the supplied reference. Upload the original to preview its contents.</p></div><button className="button primary" onClick={chooseFile} disabled={busy}><Upload size={16} />Upload presentation</button></div><div className="reference-disclosure"><BookOpen size={17} /><span>This is a heading-only reference with illustrative layouts. It is not an uploaded file or a decoder interpretation.</span></div><div className="outline-grid">{REFERENCE_SLIDES.map((title, index) => <article className="outline-slide" key={index}><ReferencePreview cover={index === 0} title={title} /><div><span>{String(index + 1).padStart(2, "0")}</span><h2>{title}</h2></div></article>)}</div>
        </>}
        {view === "guide" && <>
          <div className="page-heading"><div><h1 ref={heading} tabIndex={-1}>A template you can trust</h1><p>Keep the presentation as the source. Review the definition that sits alongside it.</p></div></div><div className="guide-layout"><div className="guide-steps">{[
            ["Upload your presentation", "Choose one .pptx file with up to 100 slides and a maximum size of 25 MB. The app stores it locally in your browser."],
            ["Review the interpretation", "The app reads slide order, text boxes, table cells, and supported images directly from the file. The preview is approximate. No AI decoder runs in this phase."],
            ["Define what can change", "Edit slide titles, assign sections, and select source objects as template fields. Give fields labels, unique keys, types, and instructions. Source content stays unchanged."],
            ["Save your template", "Save the source file and the definition together. Export the definition as JSON for a portable copy. The original .pptx can be downloaded from the editor."],
          ].map(([title, text], index) => <section key={title}><span>{index + 1}</span><div><h2>{title}</h2><p>{text}</p></div></section>)}</div><aside className="guide-aside"><ShieldCheck size={26} /><h2>About this workspace</h2><p>Presentation templates stay in this browser. In Report assistant, your audit notes and attachments are shared with the local agent and Claude as you continue.</p><p>Clearing site data removes your library. Use the definition export and keep your original file for a backup.</p><button className="button primary" onClick={chooseFile} disabled={busy}><Upload size={16} />Upload presentation</button></aside></div>
        </>}
        {view === "integrations" && <ReportAssistant records={records} activeId={activeId} onRecord={record => { setActiveId(record.id); setRecords(previous => [record, ...previous.filter(item => item.id !== record.id)]); }} />}
      </main>
    </div>
  </div>;
}

function TemplateEditor({ record, definition, onChange, onExport }: { record: StoredPresentation; definition: TemplateDefinition; onChange: (definition: TemplateDefinition) => void; onExport: () => void }) {
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState("interpretation");
  const [fieldQuery, setFieldQuery] = useState("");
  const [fieldFilter, setFieldFilter] = useState("all");
  const [fieldLimit, setFieldLimit] = useState(30);
  const slide = record.metadata.slides[selected];
  const interpretation = definition.slides[selected];
  const fields = interpretation.fields.filter(field =>
    (fieldFilter === "all" || fieldFilter === "enabled" && field.enabled || fieldFilter === "table" && field.source?.location === "table-cell") &&
    `${field.label} ${field.source?.sourceText ?? ""}`.toLowerCase().includes(fieldQuery.toLowerCase()));
  const enabledCount = interpretation.fields.filter(field => field.enabled).length;

  function changeSlide(values: Partial<TemplateSlide>) {
    onChange({ ...definition, slides: definition.slides.map((item, index) => index === selected ? { ...item, ...values } : item) });
  }
  function changeField(id: string, values: Partial<TemplateField>) {
    changeSlide({ fields: interpretation.fields.map(field => field.id === id ? { ...field, ...values } : field) });
  }
  function select(index: number) { setSelected(index); setFieldQuery(""); setFieldFilter("all"); setFieldLimit(30); }
  function addField() {
    const id = crypto.randomUUID();
    changeSlide({ fields: [...interpretation.fields, { id, source: null, label: "New field", key: `custom_${id.replaceAll("-", "_")}`, type: "text", enabled: true, required: false, instructions: "" }] });
    setFieldFilter("enabled"); setFieldQuery(""); setFieldLimit(interpretation.fields.length + 1);
  }

  return <section className="editor-workspace" aria-label="Presentation template editor">
    <div className="editor-top"><div className="editor-tabs" role="tablist" aria-label="Editor view" onKeyDown={event => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? "interpretation" : event.key === "End" ? "preview" : tab === "interpretation" ? "preview" : "interpretation";
        setTab(next); document.getElementById(`${next}-tab`)?.focus();
      }
    }}><button role="tab" id="interpretation-tab" aria-controls="interpretation-panel" aria-selected={tab === "interpretation"} tabIndex={tab === "interpretation" ? 0 : -1} className={tab === "interpretation" ? "active" : ""} onClick={() => setTab("interpretation")}><Settings2 size={16} />Template interpretation</button><button role="tab" id="preview-tab" aria-controls="preview-panel" aria-selected={tab === "preview"} tabIndex={tab === "preview" ? 0 : -1} className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}><Monitor size={16} />Presentation preview</button></div><Badge><span className="status-dot" />Decoder not connected</Badge></div>
    <div className="editor-grid">
      <aside className="slide-rail"><div className="rail-heading"><strong>Slides</strong><span>{record.metadata.slides.length}</span></div><div className="rail-list">{record.metadata.slides.map((item, index) => <button key={item.id} onClick={() => select(index)} className={`rail-slide ${selected === index ? "active" : ""}`} aria-label={`Slide ${index + 1}: ${definition.slides[index].title}`} aria-current={selected === index ? "true" : undefined}><div className="rail-thumbnail"><SlidePreview small slide={item} ratio={record.metadata.width / record.metadata.height} /></div><div className="rail-slide-label"><span>{String(index + 1).padStart(2, "0")}</span><strong>{definition.slides[index].title}</strong></div></button>)}</div></aside>
      <div className="editor-center" id={tab === "interpretation" ? "interpretation-panel" : "preview-panel"} role="tabpanel" aria-labelledby={tab === "interpretation" ? "interpretation-tab" : "preview-tab"}>
        <div className="preview-heading"><div><h2>{interpretation.title}</h2><span>Slide {selected + 1} of {record.metadata.slides.length}</span></div><div className="preview-nav"><button className="icon-button" disabled={selected === 0} onClick={() => select(selected - 1)} aria-label="Previous slide"><ChevronLeft size={17} /></button><button className="icon-button" disabled={selected === record.metadata.slides.length - 1} onClick={() => select(selected + 1)} aria-label="Next slide"><ChevronRight size={17} /></button></div></div>
        <div className="presentation-stage"><SlidePreview slide={slide} ratio={record.metadata.width / record.metadata.height} /></div><p className="preview-caption"><Monitor size={13} />Approximate source preview · your edits are stored in the definition</p>
        {tab === "interpretation" ? <div className="metadata-message"><span className="metadata-icon"><FileText size={18} /></span><div><strong>File structure, ready for your review</strong><p>Text boxes and table cells below come directly from the presentation. Select the content fields you want the future agent to fill.</p></div></div> : <section className="file-details"><h3>Source presentation</h3><dl><div><dt>File name</dt><dd>{record.metadata.fileName}</dd></div><div><dt>File size</dt><dd>{fileSize(record.metadata.fileSize)}</dd></div><div><dt>Slides</dt><dd>{record.metadata.slides.length}</dd></div><div><dt>Slide ratio</dt><dd>{(record.metadata.width / record.metadata.height).toFixed(2)}:1</dd></div><div><dt>Source layout</dt><dd>{slide.layoutName}</dd></div></dl><button className="button secondary" onClick={() => download(record.sourceFile, record.metadata.fileName)}><ArrowDownToLine size={16} />Download original .pptx</button><div className="preview-limitations"><h3>Preview limitations</h3>{record.metadata.warnings.map(warning => <p key={warning}>{warning}</p>)}</div></section>}
        <div className="slide-metadata"><span><FileText size={14} />{slide.textCount} text objects</span><span><LayoutGrid size={14} />{slide.tableCount} tables</span><span>{slide.imageCount} images</span></div>
      </div>
      <aside className="interpretation-inspector">
        <div className="inspector-section"><h3>Template details</h3><label>Template name<input value={definition.name} maxLength={160} onChange={event => onChange({ ...definition, name: event.target.value })} /></label><label>Description <span className="optional">optional</span><textarea rows={2} value={definition.description} maxLength={2000} placeholder="What is this template used for?" onChange={event => onChange({ ...definition, description: event.target.value })} /></label></div>
        {tab === "interpretation" && <><div className="inspector-section"><h3>Slide interpretation <Badge tone="blue">Manual review</Badge></h3><label>Slide title<input value={interpretation.title} maxLength={160} onChange={event => changeSlide({ title: event.target.value })} /></label><label>Section<input list="audit-sections" value={interpretation.section} maxLength={100} onChange={event => changeSlide({ section: event.target.value })} /><datalist id="audit-sections">{SECTIONS.map(section => <option key={section} value={section} />)}</datalist></label><label>Slide instructions <span className="optional">optional</span><textarea value={interpretation.instructions} rows={2} maxLength={4000} placeholder="Add guidance for this slide" onChange={event => changeSlide({ instructions: event.target.value })} /></label></div>
        <div className="inspector-section content-fields"><div className="field-heading"><h3>Content fields <span>{enabledCount} selected</span></h3><button className="icon-button" onClick={addField} aria-label="Add custom field" title="Add a manually defined field"><Plus size={16} /></button></div><p className="field-hint">All source objects start unselected. Select only what should change.</p><div className="field-filters"><label className="search-box"><Search size={14} /><input aria-label="Search content fields" value={fieldQuery} onChange={event => setFieldQuery(event.target.value)} placeholder="Search source objects" /></label><select aria-label="Filter content fields" value={fieldFilter} onChange={event => setFieldFilter(event.target.value)}><option value="all">All objects ({interpretation.fields.length})</option><option value="enabled">Selected fields</option><option value="table">Table cells</option></select></div><div className="field-list">{fields.slice(0, fieldLimit).map(field => <details key={field.id} className={`field-details ${field.enabled ? "enabled" : ""}`}><summary><span className="field-kind"><FileText size={14} /></span><span className="field-summary"><strong>{field.label || "Untitled field"}</strong><small>{field.source?.location === "table-cell" ? `Table cell · row ${(field.source.row ?? 0) + 1}, col ${(field.source.column ?? 0) + 1}` : field.source ? "Source text box" : "Manual field · no source binding"}</small></span>{field.enabled && <Check size={14} className="field-check" />}<ChevronDown size={14} /></summary><div className="field-form"><label className="checkbox-label"><input type="checkbox" checked={field.enabled} onChange={event => changeField(field.id, { enabled: event.target.checked })} />Use as a template field</label><label>Field label<input value={field.label} maxLength={200} onChange={event => changeField(field.id, { label: event.target.value })} /></label><label>Field key<input value={field.key} maxLength={200} onChange={event => changeField(field.id, { key: event.target.value })} autoCapitalize="off" spellCheck={false} /></label><label>Content type<select value={field.type} onChange={event => changeField(field.id, { type: event.target.value as TemplateField["type"] })}><option value="text">Text</option><option value="long-text">Long text</option><option value="number">Number</option><option value="date">Date</option></select></label><label className="checkbox-label"><input type="checkbox" checked={field.required} onChange={event => changeField(field.id, { required: event.target.checked })} />Required field</label><label>Field instructions<textarea rows={2} value={field.instructions} maxLength={4000} placeholder="Add instructions for the future agent" onChange={event => changeField(field.id, { instructions: event.target.value })} /></label>{field.source ? <div className="source-text"><span>Original source text</span><p>{field.source.sourceText || "Empty source object"}</p></div> : <div className="source-text"><span>Manual field</span><p>Source binding must be added when the agent integration is implemented.</p><button className="danger-text" onClick={() => changeSlide({ fields: interpretation.fields.filter(item => item.id !== field.id) })}>Remove field</button></div>}</div></details>)}{!fields.length && <p className="no-fields">{interpretation.fields.length ? "No objects match this filter." : "This slide has no source text fields. Add a manual field if needed."}</p>}{fields.length > fieldLimit && <button className="text-button show-more" onClick={() => setFieldLimit(previous => previous + 30)}>Show more objects ({fields.length - fieldLimit})<ChevronDown size={14} /></button>}</div></div></>}
        <div className="inspector-footer"><button className="text-button" onClick={onExport}><ArrowDownToLine size={14} />Export current definition</button><p>The definition is separate from the original PowerPoint.</p></div>
      </aside>
    </div>
  </section>;
}
