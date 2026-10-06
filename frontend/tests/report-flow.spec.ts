import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import type { AgentSession } from "../src/lib/agent-contract";

const ns='xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
async function reportFixture() {
  if (process.env.REPORT_PPTX) return {buffer:await readFile(process.env.REPORT_PPTX),index:4,count:13};
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<Types/>');
  zip.file('ppt/presentation.xml',`<p:presentation ${ns}><p:sldIdLst><p:sldId id="1" r:id="r1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels','<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>');
  const shape=(id:number,name:string,text:string,x:number,y:number,w:number,h:number,sz=1200,fill='FFFFFF')=>`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="${sz}"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  zip.file('ppt/slides/slide1.xml',`<p:sld ${ns}><p:cSld><p:spTree>${shape(2,'Title 1','Executive Summary',700000,400000,10000000,700000,2800)}${shape(3,'Conclusion','Audit conclusion',700000,1600000,7000000,2500000)}${shape(18,'Grade','B',9500000,1600000,1000000,1000000,3200,'FFFF00')}</p:spTree></p:cSld></p:sld>`);
  zip.file('ppt/media/retained.bin',Buffer.from('Unmodified test-only embedded content'));
  return {buffer:await zip.generateAsync({type:'nodebuffer'}),index:1,count:1};
}
async function capture(page:Page,name:string) {
 if(process.env.REPORT_CAPTURE_ONLY && name!==process.env.REPORT_CAPTURE_ONLY)return;
 await mkdir('.impeccable/review',{recursive:true});
 await page.evaluate(()=>{(document.activeElement as HTMLElement|null)?.blur();window.scrollTo({top:0,behavior:"instant"});});
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await page.screenshot({animations:'disabled',caret:'hide',path:`.impeccable/review/report-${name}.png`,fullPage:true});
}
test('completed deck upload, latest agent boundary, editable grade, preserved PowerPoint export and recovery',async({page})=>{
 const fixture=await reportFixture();
 const sessionId='11111111-1111-1111-1111-111111111111';
 let ready=false;
 let offline=false;
 let replies=0;
 let plan:{summaryFields:Array<{id:string,label:string,source:{sourceText:string},maxChars:number}>}|null=null;
 const state:AgentSession={contractVersion:1,sessionId,revision:1,status:'awaiting-input',phase:'interview',analysis:{overview:'Explicit test-only analysis. The deck supplies the report evidence.',firstQuestion:'Explicit test-only question: what caused the control gap?',processRisk:{processName:'Synthetic test process',grade:null,rationale:'Grade recommendation comes from the upstream grading step.',evidenceSlides:[]}},steps:[{id:'analysis',label:'Read presentation',status:'confirmed'},{id:'root_cause',label:'Root cause',status:'current'},{id:'positives',label:'Positive aspects',status:'pending'},{id:'grade',label:'Overall grade',status:'pending'}],message:null,messages:[{id:'q1',role:'assistant',content:'Explicit test-only question: what caused the control gap?',createdAt:'2026-10-06T12:00:00Z'}],confirmed:{},artifacts:[]};
 await page.route('**/api/agent/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(offline){
   await route.fulfill({status:path.endsWith('/status')?200:404,contentType:'application/json',body:JSON.stringify(path.endsWith('/status')?{connected:false,ready:false,canConfigure:false,message:'Explicit test-only offline agent.'}:{detail:'Explicit test-only expired conversation.'})});return;
  }
  let response:unknown;
  if(path.endsWith('/status'))response={connected:true,ready,canConfigure:true,model:'explicit-test-provider'};
  else if(path.endsWith('/configuration')){ready=true;response={connected:true,ready,canConfigure:true};}
  else if(path.endsWith('/sessions')){
   const text=route.request().postDataBuffer()!.toString('latin1');
   expect(text).toContain('name="presentation"');
   expect(text).not.toContain('name="files"');
   const match=text.match(/name="plan"\r\n\r\n([^\r]+)\r\n/);expect(match).not.toBeNull();
   plan=JSON.parse(match![1]);response=state;
  } else if(path.endsWith('/reply')){
   if(replies++===0){
    state.revision=2;state.message='More evidence is needed before recommending a process grade. Describe the finding and current controls.';
    state.messages.push({id:'missing-evidence',role:'assistant',content:state.message,createdAt:'2026-10-06T12:01:00Z'});
    state.analysis!.processRisk={processName:'Synthetic test process',grade:null,rationale:'Explicit test-only insufficient-evidence state.',evidenceSlides:[]};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(state)});return;
   }
   state.status='awaiting-review';state.revision=2;
   state.artifacts=[{id:'a1',kind:'content',title:'Executive summary draft',mimeType:'text/markdown',reviewStatus:'draft',content:'Explicit test-only board summary.',grade:'C',processRisk:{processName:'Synthetic test process',grade:'B',rationale:'Explicit test-only recommended grade rationale.',evidenceSlides:[fixture.count===13?8:fixture.index]},fields:Object.fromEntries(plan!.summaryFields.map(field=>[field.id,field.label==='Audit conclusion'?'Explicit test-only conclusion. The control gap needs an accountable owner.':field.label==='Positive aspects'?'Explicit test-only positive observation.':field.label.startsWith('Main finding 1')?'Explicit test-only finding.':field.label.startsWith('Recommendation 1')?'Assign an accountable owner (suggested by AI|test-provider).':field.label.startsWith('Finding owner')?field.source.sourceText:'']))}];response=state;
  } else if(path.endsWith('/review')){
   const body=route.request().postDataJSON();expect(body.grade).toBe('D');
   expect(Object.values(body.fields)).toContain('Human-reviewed test conclusion.');
   state.artifacts[0].fields=body.fields;state.artifacts[0].reviewedGrade=body.grade;state.artifacts[0].reviewStatus='approved';state.status='completed';state.revision=3;response=state;
  } else response=state;
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
 });
 await page.setViewportSize({width:1440,height:1050});await page.goto('/');
 await expect(page.getByRole('button',{name:'ESWriter home'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Executive summary writer',exact:true})).toBeVisible();
 await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/^Templates/})).toHaveCount(0);
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/^Previous audits/}).click();
 await expect(page.getByRole('heading',{name:'Your audit history starts here'})).toBeVisible();
 await capture(page,'audits-empty-desktop');
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Write summary',exact:true}).click();
 await capture(page,'upload-desktop');await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture(page,'upload-mobile');await page.setViewportSize({width:362,height:753});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture(page,'upload-user362');
 await page.setViewportSize({width:1440,height:1050});
 // Use a disk-backed upload: an input File can become unreadable when its source disappears.
 const uploadDirectory=await mkdtemp(join(tmpdir(),'eswriter-upload-test-'));
 try {
  const uploadPath=join(uploadDirectory,'Explicit test audit presentation.pptx');
  await writeFile(uploadPath,fixture.buffer);
  await page.getByLabel('Upload completed audit presentation').setInputFiles(uploadPath);
  await expect(page.getByRole('heading',{name:'Your report is ready to read'})).toBeVisible();
 } finally { await rm(uploadDirectory,{recursive:true,force:true}); }
 await expect(page.getByRole('button',{name:'Analyze presentation',exact:true})).toBeDisabled();
 const key='sk-ant-explicit-test-key-no-real-secret';
 await page.getByLabel('Anthropic API key',{exact:true}).fill(key);await page.locator('.claude-setup').getByRole('button',{name:'Connect Claude',exact:true}).click();
 await expect(page.locator('.chat-assistant').first()).toContainText('Explicit test-only question');
 expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain(key);
 await expect(page.getByRole('button',{name:'New report',exact:true})).toBeEnabled();
 await capture(page,'conversation-desktop');await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture(page,'conversation-mobile');await page.setViewportSize({width:362,height:753});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture(page,'conversation-user362');
 await page.reload();await expect(page.locator('.chat-assistant').first()).toContainText('Explicit test-only question');
 await page.getByLabel('Your reply to the agent',{exact:true}).fill('Explicit test-only answer.');await page.getByRole('button',{name:'Send reply',exact:true}).click();
 await expect(page.locator('.chat-assistant').last()).toContainText('More evidence is needed');
 await expect(page.getByText('More evidence needed',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Review your presentation',exact:true})).toHaveCount(0);
 await page.getByLabel('Your reply to the agent',{exact:true}).fill('Explicit test-only clarification about the finding and current controls.');await page.getByRole('button',{name:'Send reply',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Review your presentation',exact:true})).toBeVisible();
 await page.setViewportSize({width:1440,height:1050});
 await page.getByLabel('Edit Audit conclusion in presentation',{exact:true}).fill('Human-reviewed test conclusion.');
 await page.getByLabel('Process grade in presentation',{exact:true}).click();await page.getByLabel('Process grade in presentation',{exact:true}).press('Escape');await page.getByLabel('Process grade in presentation',{exact:true}).selectOption('D');
 await expect(page.getByLabel('Reviewed process grade',{exact:true})).toHaveValue('D');
 await expect(page.getByText('Agent recommendation: B',{exact:true})).toBeVisible();
 await expect(page.getByText('Risks identified in the audited process are not mitigated (one or more). Immediate actions are required.',{exact:true}).first()).toBeVisible();
 await capture(page,'review-desktop');await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture(page,'review-mobile');await page.setViewportSize({width:362,height:753});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture(page,'review-user362');
 // A rejected browser write must not claim durable review; downloading still keeps the edits.
 await expect.poll(async()=>page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const request=indexedDB.open('audit-template-studio',1);request.onsuccess=()=>resolve(request.result);});
  const rows=await new Promise<Array<{report?:{grade:string}}>>(resolve=>{const request=db.transaction('presentations','readonly').objectStore('presentations').getAll();request.onsuccess=()=>resolve(request.result);});db.close();return rows[0]?.report?.grade;
 })).toBe('D');
 await page.evaluate(()=>{
  const original=IDBObjectStore.prototype.put;
  Object.assign(window,{restoreAuditStorage:()=>{IDBObjectStore.prototype.put=original;}});
  IDBObjectStore.prototype.put=function(){throw new DOMException('Explicit test-only storage rejection','QuotaExceededError');};
 });
 await page.getByRole('button',{name:'Save reviewed presentation',exact:true}).click();
 await expect(page.getByText('Changes not saved',{exact:true})).toBeVisible();
 await expect(page.locator('.notice-error')).toContainText('latest changes could not be saved');
 await expect(page.getByText('Your reviewed summary and grade are saved for this report.',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Save reviewed presentation',exact:true})).toBeEnabled();
 await expect(page.getByRole('button',{name:'Download PowerPoint',exact:true})).toBeEnabled();
 await expect(page.getByLabel('Edit Audit conclusion in presentation',{exact:true})).toHaveValue('Human-reviewed test conclusion.');
 expect(await page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const request=indexedDB.open('audit-template-studio',1);request.onsuccess=()=>resolve(request.result);});
  const rows=await new Promise<Array<{report?:{reviewed:boolean}}>>(resolve=>{const request=db.transaction('presentations','readonly').objectStore('presentations').getAll();request.onsuccess=()=>resolve(request.result);});db.close();return rows[0]?.report?.reviewed;
 })).toBe(false);
 for(const [width,height,label] of [[1440,1050,'desktop'],[390,844,'mobile'],[362,753,'user362']] as const){
  await page.setViewportSize({width,height});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await capture(page,`storage-error-${label}`);
 }
 const recoveryDownload=page.waitForEvent('download');
 await page.getByRole('button',{name:'Download PowerPoint',exact:true}).click();
 const recoveryZip=await JSZip.loadAsync(await readFile((await (await recoveryDownload).path())!));
 expect(await recoveryZip.file(`ppt/slides/slide${fixture.index}.xml`)!.async('string')).toContain('Human-reviewed test conclusion.');
 await page.evaluate(()=>{(window as unknown as {restoreAuditStorage:()=>void}).restoreAuditStorage();});
 await page.getByRole('button',{name:'Save reviewed presentation',exact:true}).click();
 await expect(page.getByText('Your reviewed summary and grade are saved for this report.',{exact:true})).toBeVisible();
 await expect(page.getByText('Changes not saved',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Download PowerPoint',exact:true})).toBeEnabled();
 const promise=page.waitForEvent('download');await page.getByRole('button',{name:'Download PowerPoint',exact:true}).click();
 const output=await readFile((await(await promise).path())!);
 const originalZip=await JSZip.loadAsync(fixture.buffer),outputZip=await JSZip.loadAsync(output);
 expect(Object.keys(outputZip.files).sort()).toEqual(Object.keys(originalZip.files).sort());
 const changed:string[]=[];
 for(const name of Object.keys(originalZip.files).filter(name=>!originalZip.files[name].dir)){
  if(!(await originalZip.file(name)!.async('nodebuffer')).equals(await outputZip.file(name)!.async('nodebuffer')))changed.push(name);
 }
 expect(changed).toEqual([`ppt/slides/slide${fixture.index}.xml`]);
 const editedXml=await outputZip.file(changed[0])!.async('string');
 expect(editedXml).toContain('Audit conclusion');expect(editedXml).toContain('Human-reviewed test conclusion.');expect(editedXml).toMatch(/srgbClr val="ff0000"/i);
 expect(editedXml).toContain('Process grade D.');expect(editedXml).toContain('Immediate actions are required.');
 if(fixture.count===13){expect(editedXml).toContain('Process risk');expect(editedXml).toContain('gross');await mkdir('../../work/deck-render',{recursive:true});await writeFile('../../work/deck-render/edited-test.pptx',output);}
 await page.reload();await expect(page.getByLabel('Reviewed process grade',{exact:true})).toHaveValue('D');
 await expect(page.getByLabel('Edit Audit conclusion in presentation',{exact:true})).toHaveValue('Human-reviewed test conclusion.');
 await expect(page.getByRole('button',{name:'Download PowerPoint',exact:true})).toBeEnabled();
 if(fixture.count===13){await page.getByRole('button',{name:'Review slide 13: B. Distribution list',exact:true}).click();await expect(page.getByText('Slide 13 of 13',{exact:true})).toBeVisible();}
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/^Previous audits/}).click();
 await expect(page.getByText('Reviewed',{exact:true})).toBeVisible();
 await expect(page.getByText('Grade D',{exact:true})).toBeVisible();
 await page.getByLabel('Search previous audits').fill('No matching presentation');
 await expect(page.getByText('No audits match', {exact:false})).toBeVisible();
 await page.getByLabel('Search previous audits').fill('');
 for(const [width,height,label] of [[1440,1050,'desktop'],[390,844,'mobile'],[362,753,'user362']] as const){
  await page.setViewportSize({width,height});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await capture(page,`audits-${label}`);
 }
 offline=true;
 await page.getByRole('button',{name:'Open audit Explicit test audit presentation.pptx',exact:true}).click();
 await expect(page.getByText('Opened from Previous audits.',{exact:false})).toBeVisible();
 await expect(page.getByLabel('Edit Audit conclusion in presentation',{exact:true})).toHaveValue('Human-reviewed test conclusion.');
 await page.getByLabel('Reviewed process grade',{exact:true}).selectOption('C');
 await page.getByRole('button',{name:'Save reviewed presentation',exact:true}).click();
 await expect(page.getByRole('button',{name:'Download PowerPoint',exact:true})).toBeEnabled();
 const archivedDownload=page.waitForEvent('download');
 await page.getByRole('button',{name:'Download PowerPoint',exact:true}).click();
 const archivedZip=await JSZip.loadAsync(await readFile((await (await archivedDownload).path())!));
 expect(await archivedZip.file(`ppt/slides/slide${fixture.index}.xml`)!.async('string')).toContain('Process grade C.');
 const storage=await page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('audit-template-studio',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const rows=await new Promise<Array<{id:string,sourceBytes?:ArrayBuffer,sourceFile?:Blob}>>((resolve,reject)=>{const request=db.transaction('presentations','readonly').objectStore('presentations').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  db.close();return rows.map(row=>({id:row.id,hasBytes:row.sourceBytes instanceof ArrayBuffer,hasFile:!!row.sourceFile,size:row.sourceBytes?.byteLength}));
 });
 expect(storage).toEqual([{id:expect.any(String),hasBytes:true,hasFile:false,size:fixture.buffer.byteLength}]);
 // Simulate an older browser record whose persisted file reference is no longer readable.
 await page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const request=indexedDB.open('audit-template-studio',1);request.onsuccess=()=>resolve(request.result);});
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction('presentations','readwrite');const store=tx.objectStore('presentations');const request=store.getAll();request.onsuccess=()=>{for(const row of request.result){delete row.sourceBytes;row.sourceFile=new Blob();store.put(row);}};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
 });
 await page.reload();
 await expect(page.getByLabel('Reviewed process grade',{exact:true})).toHaveValue('C');
 await page.getByRole('button',{name:'Download PowerPoint',exact:true}).click();
 await expect(page.locator('.notice-error')).toContainText('original presentation is missing');
 await page.getByRole('button',{name:'New report',exact:true}).click();
 await page.getByLabel('Upload completed audit presentation').setInputFiles({name:'Explicit test audit presentation.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:fixture.buffer});
 await expect(page.getByLabel('Reviewed process grade',{exact:true})).toHaveValue('C');
 await expect(page.getByLabel('Edit Audit conclusion in presentation',{exact:true})).toHaveValue('Human-reviewed test conclusion.');
 const restoredDownload=page.waitForEvent('download');
 await page.getByRole('button',{name:'Download PowerPoint',exact:true}).click();
 expect((await readFile((await (await restoredDownload).path())!)).byteLength).toBeGreaterThan(0);
});
