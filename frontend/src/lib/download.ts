/** Give Safari and embedded browsers time to consume the attached download link. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally {
    window.setTimeout(() => { anchor.remove(); URL.revokeObjectURL(url); }, 60_000);
  }
}
