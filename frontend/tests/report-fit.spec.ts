import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import type { ReportPlan } from "../src/lib/report";

const summary = "This is layout test text for checking that the complete summary remains inside its original presentation box. ".repeat(12).trim();

test("real deck fits reviewed text, preserves source parts, and blocks actual overflow", async ({ page }) => {
  test.skip(!process.env.REPORT_PPTX, "Set REPORT_PPTX to a local reference deck; it is never committed.");
  const source = await readFile(process.env.REPORT_PPTX!);
  let session: Record<string, unknown>;
  await page.route("**/api/agent/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/status")) return route.fulfill({ json: { connected: true, ready: true, canConfigure: false } });
    if (path.endsWith("/sessions") && route.request().method() === "POST") {
      const form = await new Response(new Uint8Array(route.request().postDataBuffer()!), { headers: { "content-type": route.request().headers()["content-type"] } }).formData();
      const plan: ReportPlan = JSON.parse(String(form.get("plan")));
      const fields = Object.fromEntries(plan.summaryFields.map(f => [f.id,
        f.label === "Audit conclusion" ? summary : f.label === "Positive aspects" ? "Explicit layout test point.\nAnother layout test point." :
        f.label === "Audit title" ? "Layout verification" : f.label === "Domain" ? "Finance" : f.label === "Process risk (gross)" ? "Major" : f.label === "Key figures" ? "[KEY FIGURES: TO BE ADDED]" :
        f.label === "Main finding 2" ? "Layout test: this finding requires more than one line and its original short row must gain space from the rest of the table." :
        f.label === "Recommendation 2" ? "Layout test: assign a named owner and document the control." : f.label === "Finding owner 2" ? "Test owner" : ""]));
      session = { contractVersion: 1, sessionId: "00000000-0000-0000-0000-000000000099", revision: 1, status: "awaiting-review", steps: [], messages: [], message: null, confirmed: {}, artifacts: [{ id: "layout-test", kind: "content", title: "Explicit layout test draft", mimeType: "text/plain", reviewStatus: "draft", content: summary, fields, grade: "D" }] };
      return route.fulfill({ status: 202, json: session });
    }
    if (path.endsWith("/review")) {
      const review = route.request().postDataJSON();
      const artifact = (session.artifacts as Record<string, unknown>[])[0];
      session = { ...session, revision: 2, status: "completed", artifacts: [{ ...artifact, fields: review.fields, reviewedGrade: review.grade, reviewStatus: "approved" }] };
    }
    return route.fulfill({ json: session });
  });
  await page.goto("/");
  await expect(page.getByText("Claude connected", { exact: true })).toBeVisible();
  await page.getByLabel("Upload completed audit presentation").setInputFiles({ name: "Layout test.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: source });
  await expect(page.getByText("All summary boxes fit.", { exact: false })).toBeVisible();
  const conclusion = page.getByLabel("Edit Audit conclusion in presentation");
  const body = conclusion.locator("..");
  const fittedSize = Number(await body.getAttribute("data-fit-size"));
  expect(fittedSize).toBeLessThan(10);
  expect(Number(await body.getAttribute("data-fit-size"))).toBeGreaterThanOrEqual(8);
  await expect(body.locator(".slide-fitted-text")).toContainText("Process grade D.");
  // Short text by character count still overflows if there are many explicit lines.
  await page.getByLabel("Audit conclusion", { exact: true }).fill("Line\n".repeat(80));
  await expect(page.locator(".review-limit-error")).toContainText("minimum size of 8 pt");
  await expect(page.getByRole("button", { name: "Save reviewed presentation" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download PowerPoint" })).toBeDisabled();
  await expect(page.getByLabel("Audit conclusion", { exact: true })).toHaveValue("Line\n".repeat(80));
  await page.getByLabel("Audit conclusion", { exact: true }).fill(summary);
  await expect(page.getByText("All summary boxes fit.", { exact: false })).toBeVisible();
  for (const [width, height, name] of [[1440, 1050, "desktop"], [390, 844, "mobile"]] as const) {
    await page.setViewportSize({ width, height });
    const geometry = await page.locator('[data-fit-status="fits"]').evaluateAll(nodes => nodes.map(node => {
      const text = node.querySelector(".slide-fitted-text")!;
      const style = getComputedStyle(node);
      return { available: node.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom), text: text.getBoundingClientRect().height, width: text.clientWidth, scrollWidth: text.scrollWidth };
    }));
    expect(geometry.length).toBeGreaterThan(10);
    for (const g of geometry) { expect(g.text).toBeLessThanOrEqual(g.available + 2); expect(g.scrollWidth).toBeLessThanOrEqual(g.width + 2); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/report-fit-${name}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "Save reviewed presentation" }).click();
  await expect(page.getByRole("button", { name: "Download PowerPoint" })).toBeEnabled();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PowerPoint" }).click();
  const download = await pending;
  await download.saveAs("test-results/report-fit.pptx");
  const output = await JSZip.loadAsync(await readFile((await download.path())!));
  const input = await JSZip.loadAsync(source);
  const changed = [];
  for (const [name, entry] of Object.entries(input.files)) if (!entry.dir && !Buffer.from(await entry.async("uint8array")).equals(Buffer.from(await output.file(name)!.async("uint8array")))) changed.push(name);
  expect(changed).toEqual(["ppt/slides/slide4.xml"]);
  const slide = await output.file(changed[0])!.async("string");
  expect(slide).toContain(`sz="${fittedSize * 100}"`);
  expect(slide).toContain('typeface="Arial"');
  expect(slide).toContain("noAutofit");
  expect(slide).toContain(`<a:spcPts val="${Math.round(fittedSize * 1.15 * 100)}"`);
  expect(slide).toContain("Process grade D.");
  expect(slide).toContain("br");
  // Deleting a saved audit is explicit, cancellable, and survives a refresh.
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /^Previous audits/ }).click();
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByLabel("Delete audit Layout test.pptx").click();
  await expect(page.locator(".audit-list-row")).toHaveCount(1);
  page.once("dialog", dialog => dialog.accept());
  await page.getByLabel("Delete audit Layout test.pptx").click();
  await expect(page.locator(".audit-list-row")).toHaveCount(0);
  await expect(page.getByText("Deleted Layout test.pptx.")).toBeVisible();
  await page.reload();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /^Previous audits/ }).click();
  await expect(page.locator(".audit-list-row")).toHaveCount(0);
});
