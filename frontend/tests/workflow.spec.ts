import { test, expect } from "@playwright/test";
import JSZip from "jszip";
const pptNamespace = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const relNamespace = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const relType = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const relationship = (id: number, part: string) => `<Relationship Id="rId${id}" Type="${relType}" Target="${part}"/>`;
function sourceSlide(title: string, text: string) {
  return `<p:sld ${pptNamespace}><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="500000" y="400000"/><a:ext cx="10000000" cy="600000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2800"/><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="3" name="Text Box 2"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="500000" y="1500000"/><a:ext cx="7000000" cy="1500000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>
    <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Table 1"/></p:nvGraphicFramePr><p:xfrm><a:off x="500000" y="3500000"/><a:ext cx="7000000" cy="2000000"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="2000000"/><a:gridCol w="5000000"/></a:tblGrid><a:tr h="1000000"><a:tc><a:txBody><a:p><a:r><a:t>Finding</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>[FINDING DESCRIPTION]</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr h="1000000"><a:tc><a:txBody><a:p><a:r><a:t>Recommendation</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p/></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>
    </p:spTree></p:cSld></p:sld>`;
}
async function fixture() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>');
  // File numbering differs from presentation ordering to protect against lexical sorting.
  zip.file("ppt/presentation.xml", `<p:presentation ${pptNamespace}><p:sldIdLst><p:sldId id="257" r:id="rId2"/><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:extLst><p:ext uri="test"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><p14:section name="Section"><p14:sldIdLst><p14:sldId id="257"/><p14:sldId id="256"/></p14:sldIdLst></p14:section></p14:sectionLst></p:ext></p:extLst></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<Relationships ${relNamespace}>${relationship(1, "slides/slide1.xml")}${relationship(2, "slides/slide2.xml")}</Relationships>`);
  zip.file("ppt/slides/slide1.xml", sourceSlide("Executive Summary", "Audit conclusion"));
  zip.file("ppt/slides/slide2.xml", sourceSlide("Findings and recommendations", "[FINDING TITLE]"));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function offline(page: import("@playwright/test").Page) {
  await page.route('**/api/agent/status',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({connected:false,ready:false,canConfigure:false,message:'Test-only offline agent.'})}));
  await page.goto('/');
}
test("extension, corrupt archives, size limits, and non-PowerPoint archives fail clearly", async ({ page }) => {
  await offline(page);
  const cases = [
    { name: "wrong.txt", buffer: Buffer.from("test"), error: /Choose a .pptx file/ },
    { name: "broken.pptx", buffer: Buffer.from("not a zip"), error: /not a valid PowerPoint/ },
    { name: "empty.pptx", buffer: Buffer.alloc(0), error: /file is empty/ },
    { name: "oversized.pptx", buffer: Buffer.alloc(25 * 1024 * 1024 + 1), error: /larger than 25 MB/ },
  ];
  for (const item of cases) {
    await page.getByLabel('Upload completed audit presentation').setInputFiles({ name: item.name, mimeType: "application/octet-stream", buffer: item.buffer });
    await expect(page.locator(".notice-error")).toContainText(item.error);
  }
  const zip = new JSZip(); zip.file("hello.txt", "test");
  await page.getByLabel('Upload completed audit presentation').setInputFiles({ name: "renamed.pptx", mimeType: "application/octet-stream", buffer: await zip.generateAsync({ type: "nodebuffer" }) });
  await expect(page.locator(".notice-error")).toContainText("not a .pptx presentation");
});
test("archive expansion is rejected before extraction", async ({ page }) => {
  await offline(page);
  const buffer = await fixture();
  for (let i = 0; i < buffer.length - 46; i++) {
    if (buffer.readUInt32LE(i) === 0x02014b50) { buffer.writeUInt32LE(150 * 1024 * 1024, i + 24); break; }
  }
  await page.getByLabel('Upload completed audit presentation').setInputFiles({ name: "expansion.pptx", mimeType: "application/octet-stream", buffer });
  await expect(page.locator(".notice-error")).toContainText("expanded presentation is too large");
});

test("hosted uploads check the complete multipart size before sending to the agent", async ({ page }) => {
  let calls=0;
  await page.route('**/api/agent/**', async route => {
    if(new URL(route.request().url()).pathname.endsWith('/status')) await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({connected:true,ready:true,canConfigure:false,maxRequestBytes:4_000_000})});
    else { calls++;await route.fulfill({status:500,contentType:'application/json',body:'{"detail":"This test must not send an oversized request."}'}); }
  });
  await page.goto('/');await expect(page.getByText('Claude connected',{exact:true})).toBeVisible();
  const zip=await JSZip.loadAsync(await fixture());zip.file('ppt/media/large-test.bin',Buffer.alloc(4_010_000));
  await page.getByLabel('Upload completed audit presentation').setInputFiles({name:'Large test report.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:await zip.generateAsync({type:'nodebuffer',compression:'STORE'})});
  await expect(page.locator('.notice-error')).toContainText('too large for the hosted demo');
  expect(calls).toBe(0);
});
test("uploads appear once in previous audits and reopen after reload", async ({ page }) => {
  await offline(page);
  const buffer=await fixture();
  const input=page.getByLabel('Upload completed audit presentation');
  await input.setInputFiles({name:'Audit presentation.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer});
  await expect(page.getByRole('heading',{name:'Your report is ready to read'})).toBeVisible();
  await input.setInputFiles({name:'Another filename.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer});
  await expect(page.getByRole('heading',{name:'Your report is ready to read'})).toBeVisible();
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/^Previous audits/}).click();
  await expect(page.locator('.audit-list-row')).toHaveCount(1);
  await expect(page.getByText('Uploaded',{exact:true})).toBeVisible();
  await page.reload();
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/^Previous audits/}).click();
  await page.getByRole('button',{name:'Open audit Audit presentation.pptx',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your report is ready to read'})).toBeVisible();
  await expect(page.locator('.assistant-template-preview')).toContainText('Findings and recommendations');
  await expect(page.getByRole('button',{name:'Analyze presentation',exact:true})).toBeDisabled();
});
