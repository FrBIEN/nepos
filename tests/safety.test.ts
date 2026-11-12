import assert from 'node:assert/strict';
import { SimulationRuntime } from '../src/runtime/SimulationRuntime';
import { Host } from '../src/hardware/Host';
import { ScenarioManager } from '../src/scenario/ScenarioManager';
import { encodeProject, decodeProject } from '../src/scenario/ProjectCodec';
import { importFile } from '../src/ui/apps/FileOperations';
import { ProjectHistory } from '../src/application/ProjectHistory';
import type { ScenarioData } from '../src/scenario/ScenarioTypes';
let passed=0;
async function test(name:string,run:()=>void|Promise<void>){await run();passed++;console.log('✓ '+name);}
const runtime=new SimulationRuntime(),host=new Host({type:'rechner'},runtime),fs=runtime.hostFileSystemManager.getOrCreateFileSystem(host);
try {
await test('Uploads preserve arbitrary binary bytes and UTF-8 BOM; append cannot corrupt binary content',()=>{
    const bytes=new Uint8Array([0,255,128,13,10,65]);assert.ok(fs.writeBytes('/home/data.bin',bytes));assert.deepEqual(fs.readBytes('/home/data.bin'),bytes);
    assert.equal(fs.appendFile('/home/data.bin','bad'),false);assert.deepEqual(fs.readBytes('/home/data.bin'),bytes);
    const bom=new Uint8Array([239,187,191,65]);assert.ok(fs.writeBytes('/home/bom.txt',bom,'text/plain'));assert.deepEqual(fs.readBytes('/home/bom.txt'),bom);
});
await test('Copy and rename reject collisions by default and never lose source bytes',()=>{
    fs.writeFile('/home/target.bin','keep');assert.equal(fs.transfer('/home/data.bin','/home/target.bin'),false);assert.equal(fs.transfer('/home/data.bin','/home/target.bin',true),false);assert.equal(fs.readFile('/home/target.bin'),'keep');
    assert.ok(fs.transfer('/home/data.bin','/home/copy.bin'));assert.deepEqual(fs.readBytes('/home/data.bin'),fs.readBytes('/home/copy.bin'));
});
await test('Binary metadata and content survive complete JSON and FLS round trips',async()=>{
    const scenario=new ScenarioManager(runtime).exportScenario([host],[],'Binary',runtime.services.snapshot([host]));
    for(const format of ['json','fls'] as const){const decoded=await decodeProject(encodeProject(scenario,format).bytes,'data.'+format);const copy=new SimulationRuntime();try{const nodes=new ScenarioManager(copy).importScenario(decoded.scenario).nodes;copy.services.replace(decoded.scenario.serviceState!,nodes,[]);assert.deepEqual(copy.hostFileSystemManager.getFileSystem(host.getId())!.readBytes('/home/data.bin'),fs.readBytes('/home/data.bin'));}finally{copy.dispose();}}
});
await test('Closing an upload owner or deleting its parent prevents late writes',async()=>{
    let finish!:(buffer:ArrayBuffer)=>void;const file=new File(['content'],'late.txt',{type:'text/plain'});file.arrayBuffer=()=>new Promise(resolve=>{finish=resolve;});
    const owner=new AbortController(),upload=importFile(fs,'/home/late.txt',file,owner.signal,async()=>true);owner.abort();finish(new TextEncoder().encode('late').buffer);assert.equal(await upload,false);assert.equal(fs.exists('/home/late.txt'),false);
    fs.mkdir('/upload');const next=importFile(fs,'/upload/late.txt',file,new AbortController().signal,async()=>true);fs.delete('/upload');finish(new TextEncoder().encode('late').buffer);assert.equal(await next,false);
});
await test('Undo/redo groups edits, preserves cancelled transitions and invalidates redo after a new edit',async()=>{
    let project:ScenarioData={version:'1.0',name:'initial',createdAt:'2026-01-01T00:00:00Z',nodes:[],cables:[]},allow=true;
    const history=new ProjectHistory(()=>project,async next=>{if(!allow)return false;project=next;return true;},()=>{});
    project.name='changed';history.schedule();history.flush();assert.ok(history.canUndo);allow=false;assert.equal(await history.undo(),false);assert.equal(project.name,'changed');allow=true;
    assert.ok(await history.undo());assert.equal(project.name,'initial');assert.ok(await history.redo());assert.equal(project.name,'changed');assert.ok(await history.undo());project.name='alternative';history.schedule();history.flush();assert.equal(history.canRedo,false);history.dispose();
});
await test('History is bounded and disabled during simulation without changing project data',async()=>{
    let project:ScenarioData={version:'1.0',name:'0',createdAt:'2026-01-01T00:00:00Z',nodes:[],cables:[]};const history=new ProjectHistory(()=>project,async next=>{project=next;return true;},()=>{},2);
    for(let i=1;i<=4;i++){project.name=String(i);history.schedule();history.flush();}assert.ok(await history.undo());assert.ok(await history.undo());assert.equal(await history.undo(),false);
    history.setEnabled(false);project.name='simulation';history.schedule();assert.equal(await history.undo(),false);assert.equal(project.name,'simulation');history.setEnabled(true);assert.equal(history.canUndo,false);history.dispose();
});
} finally {runtime.dispose();}
console.log(`${passed} file safety and history tests passed`);
