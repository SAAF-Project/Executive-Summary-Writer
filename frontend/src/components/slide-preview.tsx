import type { CSSProperties } from "react";
import type { SlideMetadata } from "@/lib/types";
import { PROCESS_GRADES, type ProcessGrade, type ReportField } from "@/lib/report";

type Editing = { fields: ReportField[]; gradeField: ReportField | null; values: Record<string, string>; grade: ProcessGrade | null; onChange: (id: string, value: string) => void; onGrade: (grade: ProcessGrade | null) => void };
export function SlidePreview({ slide, ratio = 16 / 9, small = false, editing }: { slide: SlideMetadata; ratio?: number; small?: boolean; editing?: Editing }) {
  function content(id: string, value: string) {
    if (editing?.gradeField?.id === id) return <select className="slide-grade-select" aria-label="Process grade in presentation" value={editing.grade ?? ""} onChange={event => editing.onGrade(event.target.value ? event.target.value as ProcessGrade : null)} style={{ background: editing.grade ? PROCESS_GRADES.find(item => item.grade === editing.grade)!.color : "#f3f5f8", color: "#111" }}><option value="">?</option>{PROCESS_GRADES.map(item => <option key={item.grade} value={item.grade} title={item.definition}>{item.grade}</option>)}</select>;
    const field = editing?.fields.find(field => field.id === id);
    if (!field || !editing) return value;
    return <div className="slide-editable-body">{field.prefix && <strong>{field.prefix}</strong>}<textarea aria-label={`Edit ${field.label} in presentation`} value={editing.values[id] ?? ""} onChange={event => editing.onChange(id, event.target.value)} spellCheck className="slide-text-editor" />{field.prefix === "Audit conclusion" && editing.grade && <p className="slide-grade-definition">Process grade {editing.grade}. {PROCESS_GRADES.find(item => item.grade === editing.grade)!.definition}</p>}{(editing.values[id]?.length ?? 0) > field.maxChars && <span className="slide-limit-marker" title="Shorten this text to fit the slide">Shorten text</span>}</div>;
  }
  return <div className={`slide-canvas ${small ? "small" : ""} ${editing ? "editable-slide" : ""}`} style={{ aspectRatio: ratio, background: slide.background }} aria-label={`Approximate preview of slide ${slide.index}: ${slide.title}`}>
    {slide.elements.map(element => {
      const sourceId = element.id.startsWith(`${slide.id}-`) ? element.id.slice(slide.id.length + 1) : "";
      const textId = `${slide.id}-shape-${sourceId}`;
      const isGrade = editing?.gradeField?.id === textId;
      const style: CSSProperties = {
        left: `${element.x}%`, top: `${element.y}%`, width: `${element.width}%`, height: `${element.height}%`,
        background: isGrade && editing?.grade ? PROCESS_GRADES.find(item => item.grade === editing.grade)!.color : element.fill,
        color: element.color, fontWeight: element.bold ? 700 : 400,
        fontSize: `${element.fontSize ?? 1.5}cqw`, textAlign: element.align,
      };
      return <div className={`slide-object ${isGrade ? "slide-grade-object" : ""}`} key={element.id} style={style}>
        {element.kind === "image" ? <img src={element.image} alt="Embedded slide image" loading="lazy" /> :
          element.kind === "table" ? <table><colgroup>{element.columnWidths?.map((width, i) => <col key={i} style={{ width: `${width / element.columnWidths!.reduce((a, b) => a + b, 0) * 100}%` }} />)}</colgroup><tbody>{element.rows?.map((row, ri) => <tr key={ri} style={element.rowHeights ? { height: `${element.rowHeights[ri] / element.rowHeights.reduce((a, b) => a + b, 0) * 100}%` } : undefined}>{row.map((cell, ci) => {
            const source = element.cells?.[ri]?.[ci];
            if (source?.hidden) return null;
            const cellId = `${slide.id}-table-${sourceId}-${ri}-${ci}`;
            return <td key={ci} colSpan={source?.colSpan} rowSpan={source?.rowSpan} style={source ? { background: source.fill, color: source.color, fontSize: `${source.fontSize}cqw`, fontWeight: source.bold ? 700 : 400 } : undefined}>{content(cellId, cell)}</td>;
          })}</tr>)}</tbody></table> : content(textId, element.text ?? "")}
      </div>;
    })}
  </div>;
}

export function ReferencePreview({ title = "Internal audit report", cover = false }: { title?: string; cover?: boolean }) {
  return <div className={`reference-slide ${cover ? "reference-cover" : ""}`} aria-label="Illustrative reference layout">
    {cover ? <><div className="reference-band" /><div className="reference-cover-copy"><span>Internal Audit</span><strong>Audit report<br />template</strong><span>Reference outline · 13 slides</span></div></> : <>
      <strong className="reference-title">{title}</strong>
      <div className="reference-columns"><div><span>Section</span><div /><div /><div /></div><div><span>Content area</span><div /><div /><div /><div /></div></div>
      <div className="reference-footer"><span>Introduction</span><span>Executive summary</span><span>Process dashboard</span><span>Findings</span><span>Appendices</span></div>
    </>}
  </div>;
}
