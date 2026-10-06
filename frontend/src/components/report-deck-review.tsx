"use client";
import { useState } from "react";
import { ArrowDownToLine, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import type { AgentSession } from "@/lib/agent-contract";
import { exportReport, PROCESS_GRADES, type ProcessGrade, type ReportEdits, type ReportPlan } from "@/lib/report";
import type { StoredPresentation } from "@/lib/types";
import { downloadBlob } from "@/lib/download";
import { SlidePreview } from "./slide-preview";

export function ReportDeckReview({ record, plan, session, edits, busy, unsaved, recoveryDownload, onChange, onApprove, onError }: { record: StoredPresentation; plan: ReportPlan; session: AgentSession; edits: ReportEdits; busy: boolean; unsaved: boolean; recoveryDownload: boolean; onChange: (edits: ReportEdits) => void; onApprove: () => void; onError: (message: string) => void }) {
  const [slideId, setSlideId] = useState(plan.summarySlideId ?? record.metadata.slides[0].id);
  const [exporting, setExporting] = useState(false);
  const slide = record.metadata.slides.find(item => item.id === slideId) ?? record.metadata.slides[0];
  const artifact = session.artifacts.find(item => item.kind === "content");
  const risk = artifact?.processRisk ?? session.analysis?.processRisk;
  const definition = PROCESS_GRADES.find(item => item.grade === edits.grade);
  const tooLong = plan.summaryFields.filter(field => (edits.fields[field.id]?.length ?? 0) > field.maxChars);
  const missingMapping = !plan.gradeField || !plan.summaryFields.length;
  const canExport = (edits.reviewed || recoveryDownload) && !!edits.grade && !tooLong.length && !missingMapping;
  function editField(id: string, value: string) { onChange({ ...edits, reviewed: false, fields: { ...edits.fields, [id]: value } }); }
  function editGrade(grade: ProcessGrade | null) { onChange({ ...edits, reviewed: false, grade }); }
  async function download() {
    setExporting(true);
    try {
      const blob = await exportReport(record.sourceFile, record.metadata, plan, edits.fields, edits.grade);
      downloadBlob(blob, record.metadata.fileName.replace(/\.pptx$/i, " - Executive summary.pptx"));
    } catch (error) { onError(error instanceof Error ? error.message : "The PowerPoint could not be exported. Try again."); }
    finally { setExporting(false); }
  }
  return <section className="report-review" aria-label="Review complete presentation">
    <div className="report-review-heading"><div><h2>Review your presentation</h2><p>Browse every slide. Edit the executive summary and click the grade box to choose A–D.</p></div><span className={`badge ${!unsaved && edits.reviewed ? "badge-green" : "badge-blue"}`}>{unsaved ? "Changes not saved" : edits.reviewed ? "Reviewed" : "Ready for your review"}</span></div>
    {missingMapping && <div className="notice notice-error" role="alert">The summary or process-grade area was not found in this layout. Use the supplied audit-report structure before exporting.</div>}
    {artifact?.warnings?.map(warning => <div className="notice notice-info" role="status" key={warning}>{warning}</div>)}
    <div className="report-review-layout">
      <nav className="report-slide-rail" aria-label="Presentation slides">{record.metadata.slides.map(item => <button key={item.id} onClick={() => setSlideId(item.id)} className={slide.id === item.id ? "selected" : ""} aria-current={slide.id === item.id ? "true" : undefined} aria-label={`Review slide ${item.index}: ${item.title}`}><SlidePreview slide={item} small ratio={record.metadata.width / record.metadata.height} /><span>{item.index}. {item.title}</span></button>)}</nav>
      <div className="report-slide-stage"><div className="report-slide-toolbar"><strong>Slide {slide.index} of {record.metadata.slides.length}</strong><span>{slide.title}</span><div><button className="icon-button" aria-label="Previous report slide" disabled={slide.index === 1} onClick={() => setSlideId(record.metadata.slides[slide.index - 2].id)}><ChevronLeft size={17} /></button><button className="icon-button" aria-label="Next report slide" disabled={slide.index === record.metadata.slides.length} onClick={() => setSlideId(record.metadata.slides[slide.index].id)}><ChevronRight size={17} /></button></div></div>
        <div className="report-canvas-scroll"><div className="report-canvas-inner"><SlidePreview slide={slide} ratio={record.metadata.width / record.metadata.height} editing={{ fields: plan.summaryFields, gradeField: plan.gradeField, values: edits.fields, grade: edits.grade, onChange: editField, onGrade: editGrade }} /></div></div>
        <p className="report-preview-note">Layout preview is approximate. Charts and some PowerPoint styling may differ. The download retains the original slides and includes your reviewed edits.</p>
      </div>
      <aside className="report-review-inspector">
        <h3>Process grade</h3><label className="sr-only" htmlFor="review-process-grade">Reviewed process grade</label><select id="review-process-grade" value={edits.grade ?? ""} onChange={event => editGrade(event.target.value ? event.target.value as ProcessGrade : null)}><option value="">Choose a grade</option>{PROCESS_GRADES.map(item => <option key={item.grade} value={item.grade}>{item.grade} · {item.label}</option>)}</select>
        {definition && <div className="grade-definition"><span style={{ background: definition.color }}>{definition.grade}</span><p>{definition.definition}</p></div>}
        {risk && <div className="risk-evidence"><strong>Agent recommendation: {risk.grade ?? "Insufficient evidence"}</strong>{risk.processName && <p>{risk.processName}</p>}<p>{risk.rationale}</p>{risk.evidenceSlides.length > 0 && <p>Evidence: slides {risk.evidenceSlides.join(", ")}</p>}{edits.grade && edits.grade !== risk.grade && <p className="grade-override">You selected {edits.grade}. The original recommendation remains here for comparison.</p>}</div>}
        <h3>Summary on this slide</h3>{plan.summaryFields.filter(field => field.slideId === slide.id).map(field => <details key={field.id} open={field.label === "Audit conclusion"}><summary>{field.label}<small>{(edits.fields[field.id] ?? "").length}/{field.maxChars}</small></summary><label className="sr-only" htmlFor={`review-${field.id}`}>{field.label}</label><textarea id={`review-${field.id}`} rows={field.label === "Audit conclusion" ? 7 : 3} value={edits.fields[field.id] ?? ""} onChange={event => editField(field.id, event.target.value)} /></details>)}{!plan.summaryFields.some(field => field.slideId === slide.id) && <p>This slide retains its uploaded content. Select the executive-summary slide to edit the summary.</p>}
        {tooLong.length > 0 && <p className="review-limit-error" role="alert">Shorten {tooLong.map(field => field.label).join(", ")} to fit the slide.</p>}
        <p className="review-grade-note">The selected grade’s definition is included in the audit conclusion. Review it with the report evidence.</p>
      </aside>
    </div>
    <div className="report-review-actions"><p>{unsaved ? "Your latest changes are not saved. Download a copy to keep them, then try saving again." : edits.reviewed ? "Your reviewed summary and grade are saved for this report." : "Review the wording and select the process grade before downloading."}</p><div className="button-row"><button className="button secondary" onClick={onApprove} disabled={busy || exporting || (edits.reviewed && !unsaved) || !edits.grade || !!tooLong.length || missingMapping}>{busy ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />}Save reviewed presentation</button><button className="button primary" onClick={() => void download()} disabled={!canExport || exporting || busy}>{exporting ? <LoaderCircle size={16} className="spin" /> : <ArrowDownToLine size={16} />}Download PowerPoint</button></div></div>
  </section>;
}
