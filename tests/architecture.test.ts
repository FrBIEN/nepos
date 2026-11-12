import assert from 'node:assert/strict';
import { EventBus } from '../src/core/EventBus';
import { Lifetime } from '../src/core/Lifetime';
import { ApplicationEvents } from '../src/application/ApplicationEvents';
import { PacketJournal } from '../src/network/PacketJournal';
import { ProjectController, type ProjectWorkspace } from '../src/application/ProjectController';
import { ProjectStore } from '../src/scenario/ProjectStore';
import { ScenarioManager } from '../src/scenario/ScenarioManager';
import type { ScenarioData, ServiceState } from '../src/scenario/ScenarioTypes';
import { Host } from '../src/hardware/Host';
let passed=0;
async function test(name:string,run:()=>void|Promise<void>){await run();console.log('✓ '+name);passed++;}
const blank=(name='Project'):ScenarioData=>({version:'1.0',name,createdAt:new Date(0).toISOString(),nodes:[],cables:[]});
function fixture(){
    const memory=new Map<string,string>();const store=new ProjectStore({getItem:key=>memory.get(key)??null,setItem:(key,value)=>{memory.set(key,value);},removeItem:key=>{memory.delete(key);}});
    let nodes:ReturnType<ScenarioManager['importScenario']>['nodes']=[],cables:ReturnType<ScenarioManager['importScenario']>['cables']=[],documents:NonNullable<ScenarioData['docElements']>=[];
    const workspace:ProjectWorkspace={nodes:()=>nodes,cables:()=>cables,documents:()=>documents,replace:(n,c,d)=>{nodes=n;cables=c;documents=d;}};
    let state:ServiceState={dhcpServers:[]};let allow=true,closed=0,metadata='',failed=false;
    const errors:string[]=[];const scenarios=new ScenarioManager();
    const controller=new ProjectController({store,scenarios,workspace,network:{updateTopology:()=>{}},windows:{prepareClose:async()=>allow,closeAll:()=>closed++},
        services:{snapshot:()=>structuredClone(state),replace:next=>{if(failed)throw new Error('Late failure');state={dhcpServers:[],...next};}},
        onMetadata:name=>metadata=name,onError:message=>errors.push(message)});
    return {controller,store,memory,scenarios,workspace,errors,setAllow:(value:boolean)=>allow=value,setFailed:(value:boolean)=>failed=value,get closed(){return closed;},get metadata(){return metadata;}};
}
await test('Lifetime removes listeners and cancelled timers; disposal does not leave intervals running',async()=>{
    const lifetime=new Lifetime(),target=new EventTarget();let calls=0,timers=0,cleaned=0;
    lifetime.listen(target,'click',()=>calls++);target.dispatchEvent(new Event('click'));assert.equal(calls,1);
    const timer=lifetime.timeout(()=>timers++,0);lifetime.cancelTimeout(timer);
    lifetime.interval(()=>timers++,1);const child=lifetime.child();child.add(()=>cleaned++);
    lifetime.dispose();lifetime.dispose();target.dispatchEvent(new Event('click'));
    await new Promise(resolve=>setTimeout(resolve,15));assert.equal(calls,1);assert.equal(timers,0);assert.equal(cleaned,1);
});
await test('Scoped application events unsubscribe and enforce payload contracts',()=>{
    const bus=new EventBus(),events=new ApplicationEvents(bus),scope=new Lifetime();let calls=0;
    scope.add(events.on('service:state-changed',()=>calls++).unsubscribe);events.emit('service:state-changed',{type:'editor'});
    scope.dispose();events.emit('service:state-changed',{type:'editor'});assert.equal(calls,1);assert.equal(bus.listenerCount(),0);
    if(false){
        // @ts-expect-error Wrong event payloads must fail compilation.
        events.emit('desktop:open',{device:new Host({type:'rechner'})});
        // @ts-expect-error Protocol internals must not leak into UI event contracts.
        events.on('socket:connect',()=>{});
    }
});
await test('PacketJournal works without DOM and retains real TCP control-like payloads and headers',()=>{
    const bus=new EventBus(),journal=new PacketJournal(bus,()=>42,2);let changes=0,logged=0;
    const unsubscribe=journal.subscribe(()=>changes++);bus.on('packet:logged',()=>logged++);
    const data={sourceIP:'10.0.0.1',destIP:'10.0.0.2',sourceMAC:'00:00:00:00:00:01',destMAC:'00:00:00:00:00:02',size:3,info:'Sent',protocol:'TCP',payload:'SYN',ttl:64,tcp:{flags:'PSH ACK',seq:1,ack:2}};
    journal.addEntry(data);assert.ok(journal.getEntries()[0].layers!.some(layer=>layer.fields.some(field=>field.value==='SYN')));
    journal.addEntry(data);journal.addEntry(data);assert.equal(journal.getEntries().length,2);assert.equal(logged,3);assert.equal(journal.getEntries()[0].timestamp,42);assert.deepEqual(journal.getEntries()[0].tcp,data.tcp);
    unsubscribe();journal.clear();assert.equal(changes,3);assert.equal(journal.getEntries().length,0);
});
await test('A failing packet projection cannot interrupt packet recording or other subscribers',()=>{
    const journal=new PacketJournal(new EventBus(),()=>0);let received=0,errors=0;
    journal.subscribe(()=>{throw new Error('Broken view');});journal.subscribe(()=>received++);
    const report=console.error;console.error=()=>{errors++;};
    try{journal.addEntry({sourceIP:'10.0.0.1',destIP:'10.0.0.2',sourceMAC:'a',destMAC:'b',size:1,info:'Live traffic',protocol:'UDP'});}
    finally{console.error=report;}
    assert.equal(journal.getEntries().length,1);assert.equal(received,1);assert.equal(errors,1);
});
await test('Failed restoration blocks every persistence path and preserves unreadable raw data',()=>{
    const f=fixture();f.memory.set('nepos-project','{broken');f.controller.restore();
    assert.equal(f.controller.autosaveBlocked,true);assert.equal(f.controller.persist(),false);assert.equal(f.memory.get('nepos-project'),'{broken');assert.equal(f.workspace.nodes().length,0);f.controller.dispose();
});
await test('Recovery requires explicit continuation before overwriting a damaged current document',()=>{
    const f=fixture();f.store.save(blank('Good'));f.store.save(blank('Next'));f.memory.set('nepos-project','{broken');f.controller.restore();
    assert.equal(f.metadata,'Good');assert.equal(f.controller.persist(),false);assert.equal(f.memory.get('nepos-project'),'{broken');
    assert.equal(f.controller.recovery().resume!(),true);assert.equal(f.memory.get('nepos-project-recovery'),'{broken');assert.equal(f.controller.autosaveBlocked,false);f.controller.dispose();
});
await test('Cancelled close guards and invalid imports preserve workspace and active scenario',async()=>{
    const f=fixture();await f.controller.replace(blank('Original'));const previous=f.scenarios.getCurrentScenario();f.setAllow(false);
    assert.equal(await f.controller.replace(blank('Replacement')),false);assert.equal(f.metadata,'Original');assert.equal(f.scenarios.getCurrentScenario(),previous);
    f.setAllow(true);await assert.rejects(()=>f.controller.replace({...blank(),version:'invalid'}));assert.equal(f.scenarios.getCurrentScenario(),previous);assert.equal(f.controller.busy,false);f.controller.dispose();
});
await test('Concurrent replacements cannot bypass an outstanding close guard',async()=>{
    const f=fixture();await f.controller.replace(blank('Original'));
    const first=f.controller.replace(blank('First')),second=f.controller.replace(blank('Second'));
    assert.equal(await second,false);assert.equal(await first,true);assert.equal(f.metadata,'First');assert.equal(f.closed,2);f.controller.dispose();
});
await test('Late service failures keep the old workspace and committed scenario',async()=>{
    const f=fixture(),original={...blank('Original'),nodes:[{id:'old-host',type:'rechner' as const}]};await f.controller.replace(original);
    const node=f.workspace.nodes()[0],active=f.scenarios.getCurrentScenario();f.setFailed(true);
    await assert.rejects(()=>f.controller.replace(blank('Candidate')),/Late failure/);assert.equal(f.workspace.nodes()[0],node);assert.equal(f.scenarios.getCurrentScenario(),active);assert.equal(f.metadata,'Original');assert.equal(f.controller.busy,false);f.controller.dispose();
});
await test('Project metadata is captured from state and disposal cancels scheduled autosaves',async()=>{
    const f=fixture();await f.controller.replace(blank('Original date'));assert.equal(f.controller.capture().createdAt,new Date(0).toISOString());
    f.controller.setMetadata('Edited','Description');assert.equal(f.controller.capture().name,'Edited');assert.equal(f.controller.capture().description,'Description');
    f.controller.dispose();assert.equal(f.controller.persist(),false);assert.equal(JSON.parse(f.memory.get('nepos-project')!).name,'Original date');
});
console.log(`${passed} architecture tests passed`);
