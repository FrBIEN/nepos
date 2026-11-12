import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { readZip, writeZip } from '../src/scenario/fls/ZipArchive';
import { importFiliusXML } from '../src/scenario/fls/FiliusImport';
import { validateScenario } from '../src/scenario/ScenarioValidation';
import { decodeJavaBeans } from '../src/scenario/fls/JavaBeansData';
const filiusHome = process.env.FILIUS_HOME ?? '..';
const examples = `${filiusHome}/beispiele`;
for(const name of (existsSync(examples) ? readdirSync(examples) : []).filter(n=>n.endsWith('.fls'))){
    const archive=await readZip(new Uint8Array(readFileSync(`${examples}/${name}`)));
    const xml=archive.get('projekt/konfiguration.xml')!;
    const {scenario,warnings}=importFiliusXML(new TextDecoder().decode(xml),name);
    validateScenario(scenario);console.log(`✓ Original FLS ${name}: ${scenario.nodes.length} devices, ${scenario.cables.length} cables${warnings.length?' (migration notices)':''}`);
}
const bytes=writeZip(new Map([['projekt/konfiguration.xml',new TextEncoder().encode('Grüße 🌐')]]));assert.equal(new TextDecoder().decode((await readZip(bytes)).get('projekt/konfiguration.xml')),'Grüße 🌐');
const corrupt=bytes.slice();corrupt[60]^=1;await assert.rejects(()=>readZip(corrupt));
assert.throws(()=>decodeJavaBeans('<!DOCTYPE java [<!ENTITY x SYSTEM "file:///etc/passwd">]><java>&x;</java>'));
assert.throws(()=>decodeJavaBeans('<java><object class="java.lang.Runtime" method="getRuntime"/></java>'));
console.log('✓ FLS archive integrity and data-only XML rejection');

// Full Nepos state must survive FLS, while the Java-compatible projection remains independently readable.
const { encodeProject, decodeProject }=await import('../src/scenario/ProjectCodec');
const example=JSON.parse(readFileSync('public/examples/lernnetz.json','utf8'));
example.name='Nepos – Grüße 🌐';example.description='Netzwerke erforschen – Protokolle online simulieren.';
const original=structuredClone(example),encoded=encodeProject(example,'fls');
assert.deepEqual((await decodeProject(encoded.bytes,'test.fls')).scenario,original);
const archive=await readZip(encoded.bytes);archive.delete('projekt/nepos.json');
const projected=await decodeProject(writeZip(archive),'test.fls');assert.equal(projected.scenario.nodes.length,example.nodes.length);assert.equal(projected.scenario.cables.length,example.cables.length);
assert.equal(projected.scenario.serviceState!.emailServers!.filter(s=>s.running).length,1);assert.equal(projected.scenario.serviceState!.dnsServers!.find(s=>s.running)!.records[0].name,example.serviceState.dnsServers[0].records[0].name);
assert.ok(JSON.stringify(projected.scenario.serviceState!.emailClients).includes('schueler@schule.test'));
const { exportFiliusXML }=await import('../src/scenario/fls/FiliusExport');const special=structuredClone(example);special.name='Special XML';special.serviceState.webServers[0].files[0].content='A\0B <script>Grüße 🌐 & "quotes"</script>';
const specialXML=exportFiliusXML(special).xml;const specialImport=importFiliusXML(specialXML,'test');assert.equal(specialImport.scenario.serviceState!.webServers!.find(s=>s.running)!.files[0].content,special.serviceState.webServers[0].files[0].content);
const changed=await readZip(encoded.bytes);changed.set('projekt/konfiguration.xml',new TextEncoder().encode(new TextDecoder().decode(changed.get('projekt/konfiguration.xml')).replaceAll('Tablet-Client','Java-Edited')));
const changedImport=await decodeProject(writeZip(changed),'changed.fls');assert.match(changedImport.warnings[0],/Zusatzdaten/);assert.ok(changedImport.scenario.nodes.some(node=>node.name==='Java-Edited'));
console.log('✓ FLS lossless Nepos roundtrip, independent Java projection, Unicode/control characters and stale-extension detection');

const { ProjectStore }=await import('../src/scenario/ProjectStore');
const memory=new Map<string,string>(),storage={getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value);},removeItem:(key:string)=>{memory.delete(key);}};
const store=new ProjectStore(storage);memory.set('filius-web-autosave',JSON.stringify(example));memory.set('filius-project-title','Legacy project');
assert.equal(store.load()!.name,'Legacy project');assert.ok(memory.has('nepos-project'));
const before=memory.get('nepos-project');assert.throws(()=>store.save({...example,version:'invalid'}));assert.equal(memory.get('nepos-project'),before);
store.save(example);assert.deepEqual(store.load(),example);store.clear();assert.equal(store.load(),null);
console.log('✓ ProjectStore validates before atomic writes and migrates the previous browser project');

const { ScenarioManager }=await import('../src/scenario/ScenarioManager');
const { services }=await import('../src/apps/Services');
const runtime=new ScenarioManager().importScenario(example);services.restore(example.serviceState,runtime.nodes);
const snapshot=new ScenarioManager().exportScenario(runtime.nodes,runtime.cables,'After runtime',services.snapshot(runtime.nodes));
const runtimeExport=encodeProject(snapshot,'fls');assert.equal((await decodeProject(runtimeExport.bytes,'runtime.fls')).scenario.serviceState!.webServers!.find(s=>s.running)!.files.length,example.serviceState.webServers[0].files.length);services.restore();
console.log('✓ Exporting actual service snapshots preserves web files with absolute service paths');

// Storage recovery never depends on a successful migration write.
const fullStorage={...storage,setItem:()=>{throw new DOMException('full','QuotaExceededError');}};
memory.clear();memory.set('filius-web-autosave',JSON.stringify(example));
const migration=new ProjectStore(fullStorage);assert.deepEqual(migration.load(),example);assert.ok(migration.loadWarning);assert.equal(memory.has('nepos-project'),false);
memory.clear();store.save(example);store.save({...example,name:'Next version'});
assert.deepEqual(JSON.parse(memory.get('nepos-project-backup')!),example);
memory.set('nepos-project','{broken');assert.deepEqual(store.load(),example);assert.ok(store.loadWarning);assert.equal(memory.get('nepos-project'),'{broken');
store.save(example);assert.equal(memory.get('nepos-project-recovery'),'{broken');
const originalCurrent=memory.get('nepos-project');const quota=new ProjectStore(fullStorage);
assert.throws(()=>quota.save({...example,name:'Cannot save'}),{name:'QuotaExceededError'});assert.equal(memory.get('nepos-project'),originalCurrent);
memory.clear();memory.set('nepos-project','{broken');assert.throws(()=>store.load());assert.equal(memory.get('nepos-project'),'{broken');assert.equal(store.recoveryDocuments()[0].content,'{broken');
console.log('✓ Quota-safe legacy recovery, previous-good backup, corrupt-original preservation and failed writes');

const invalid=structuredClone(example);const firstHost=invalid.nodes.find((n:any)=>n.type==='rechner'||n.type==='notebook').id;
invalid.serviceState.fileSystems=[{hostId:firstHost,fsState:{name:'',isDirectory:true,lastModified:'invalid-date'}}];
assert.throws(()=>validateScenario(invalid),/Dateidatum/);
invalid.serviceState.fileSystems[0].fsState.lastModified=new Date(0).toISOString();invalid.serviceState.fileSystems[0].fsState.mimeType={bad:true};
assert.throws(()=>validateScenario(invalid),/Dateityp/);
console.log('✓ Invalid file timestamps and MIME types are rejected before restoration');

services.restore(example.serviceState,runtime.nodes);
const previous=structuredClone(services.snapshot(runtime.nodes));
const {hostEmailClientManager}=await import('../src/apps/email/EmailClient');
const restoreEmail=hostEmailClientManager.restoreServiceState.bind(hostEmailClientManager);let injected=true;
hostEmailClientManager.restoreServiceState=(...args)=>{if(injected){injected=false;throw new Error('Injected late restore failure');}restoreEmail(...args);};
try{assert.throws(()=>services.replace({},[],runtime.nodes),/Injected late restore failure/);assert.deepEqual(JSON.parse(JSON.stringify(services.snapshot(runtime.nodes))),JSON.parse(JSON.stringify(previous)));}
finally{hostEmailClientManager.restoreServiceState=restoreEmail;}
const {editorSessions}=await import('../src/apps/EditorSessions');
editorSessions.set(firstHost,[{path:null,name:'Unbenannt',content:'Recover unsaved Grüße',isDirty:true}],0);
const draftProject=structuredClone(example);draftProject.serviceState=services.snapshot(runtime.nodes);
const draftExport=encodeProject(draftProject,'fls');assert.ok(draftExport.warnings.some(w=>w.includes('Textentwürfe')));
const reopened=(await decodeProject(draftExport.bytes,'draft.fls')).scenario;
services.restore(reopened.serviceState,runtime.nodes);assert.equal(editorSessions.get(firstHost)!.tabs[0].content,'Recover unsaved Grüße');
services.restore();console.log('✓ Late restore rollback and unsaved editor recovery through FLS and service restoration');

memory.clear();store.save(example);store.checkpoint(example);store.save({...example,name:'Imported'});store.save({...example,name:'Imported, edited'});
assert.equal(JSON.parse(memory.get('nepos-project-before-replace')!).name,example.name);
console.log('✓ The project before an explicit replacement survives subsequent autosaves');
