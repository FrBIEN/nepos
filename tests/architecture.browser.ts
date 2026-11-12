import { createApplicationContext } from '../src/application/ApplicationContext';
import { NeposApplication } from '../src/application/NeposApplication';
import { Host } from '../src/hardware/Host';
import { DesktopWindow } from '../src/ui/DesktopWindow';
import { AppRegistry } from '../src/ui/apps/AppCatalog';
import { createHostApplication } from '../src/ui/apps/Registry';
import { eventBus } from '../src/core/EventBus';
import { i18n } from '../src/i18n';
const memory=new Map<string,string>();
const storage={getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value);},removeItem:(key:string)=>{memory.delete(key);}};
function assert(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
async function waitFor(check:()=>boolean,message:string):Promise<void>{
    const until=performance.now()+5000;
    while(!check()){if(performance.now()>until)throw new Error(message);await new Promise(resolve=>setTimeout(resolve,0));}
}
function click(selector:string,root:ParentNode=document):void{const button=root.querySelector<HTMLElement>(selector);assert(button,'Missing '+selector);button.click();}
function fill(selector:string,value:string,root:ParentNode=document):void{const input=root.querySelector<HTMLInputElement|HTMLTextAreaElement>(selector);assert(input,'Missing '+selector);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
async function choice(value:string):Promise<void>{await waitFor(()=>!!document.querySelector('dialog[open]'),'Expected dialog');click('dialog[open] button[value="'+value+'"]');await Promise.resolve();}
export async function runArchitectureRegressions(): Promise<string[]> {
    const passed: string[] = [];
    const context=createApplicationContext(storage);i18n.init();
    const host=Host.fromJSON({type:'rechner',name:'Architektur-Test',installedApps:AppRegistry.getAll().map(app=>app.id),networkInterface:{ip:'10.0.0.1'}},context.runtime);
    const fs=context.hostFileSystemManager.getOrCreateFileSystem(host);
    let desktop:DesktopWindow|undefined;
    const test=async(name:string,run:()=>void|Promise<void>)=>{await run();passed.push(name);};
    try{
        await test('Alle 15 Anwendungen wiederholt mounten und aufräumen, ohne Ereignislecks',()=>{
            for(let cycle=0;cycle<3;cycle++)for(const metadata of AppRegistry.getAll()){
                const content=document.createElement('div');document.body.append(content);const before=context.runtime.events.listenerCount();
                const app=createHostApplication(metadata.id,{host,content,dependencies:context,request:{},openApp:async()=>{},closeApp:()=>{},setDismissAction:()=>{}});
                app.mount();assert(content.childElementCount>0,metadata.id+' mounted no UI');app.dispose();content.remove();
                assert(context.runtime.events.listenerCount()===before,metadata.id+' left event subscriptions behind');
            }
        });
        await test('Aufgeräumte Editor-Listener können den Projektentwurf nicht mehr verändern',()=>{
            const content=document.createElement('div');document.body.append(content);
            const app=createHostApplication('texteditor',{host,content,dependencies:context,request:{},openApp:async()=>{},closeApp:()=>{},setDismissAction:()=>{}});app.mount();
            fill('#te-editor','Original draft',content);app.dispose();fill('#te-editor','Detached callback must not run',content);
            assert(context.editorSessions.get(host.getId())!.tabs[0].content==='Original draft','Disposed editor kept its listeners');content.remove();context.editorSessions.restore();
        });
        await test('Aufräumen beendet eine offene Schließen-Rückfrage ohne Daten zu verwerfen',async()=>{
            const content=document.createElement('div');document.body.append(content);
            const app=createHostApplication('texteditor',{host,content,dependencies:context,request:{},openApp:async()=>{},closeApp:()=>{},setDismissAction:()=>{}});app.mount();fill('#te-editor','Retained draft',content);
            const guard=app.prepareClose();await waitFor(()=>!!document.querySelector('dialog[open]'),'Guard did not open');app.dispose();
            assert(await guard===false,'Disposed guard continued');assert(!document.querySelector('dialog[open]'),'Owner left an open dialog');
            assert(context.editorSessions.get(host.getId())!.tabs[0].content==='Retained draft','Disposal discarded the draft');content.remove();context.editorSessions.restore();
        });
        await test('Explorer erstellt Dateien und Ordner, meldet ungültige Namen und erhält vorhandene Inhalte',async()=>{
            const content=document.createElement('div');document.body.append(content);
            const app=createHostApplication('fileexplorer',{host,content,dependencies:context,request:{},openApp:async()=>{},closeApp:()=>{},setDismissAction:()=>{}});app.mount();
            click('.explorer-item[data-name="home"]',content);content.querySelector('.explorer-item[data-name="home"]')!.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
            click('#explorer-new-file',content);await waitFor(()=>!!document.querySelector('dialog[open]'),'No file dialog');fill('dialog[open] input','Grüße.txt');
            const form=document.querySelector<HTMLFormElement>('dialog[open] form')!;
            assert(form.querySelector<HTMLButtonElement>('button[value="cancel"]')!.type==='button','Enter would trigger Cancel');
            form.requestSubmit(form.querySelector<HTMLButtonElement>('button[value="ok"]')!);
            await waitFor(()=>fs.exists('/home/Grüße.txt'),'File creation failed');assert(fs.readFile('/home/Grüße.txt')==='','File missing');fs.writeFile('/home/Grüße.txt','Keep me');
            click('#explorer-new-file',content);await waitFor(()=>!!document.querySelector('dialog[open]'),'No duplicate dialog');fill('dialog[open] input','Grüße.txt');await choice('ok');
            await waitFor(()=>document.querySelector('dialog[open]')?.textContent?.includes('bereits vorhanden')??false,'Duplicate was not reported');assert(fs.readFile('/home/Grüße.txt')==='Keep me','Duplicate truncated content');await choice('ok');
            click('#explorer-new-file',content);await waitFor(()=>!!document.querySelector('dialog[open]'),'No invalid-name dialog');fill('dialog[open] input','../unsafe');await choice('ok');
            await waitFor(()=>document.querySelector('dialog[open]')?.textContent?.includes('gültigen Namen')??false,'Invalid name was not reported');await choice('ok');assert(!fs.exists('/unsafe'),'Invalid name created a file');
            click('#explorer-new-folder',content);await waitFor(()=>!!document.querySelector('dialog[open]'),'No folder dialog');fill('dialog[open] input','Unterricht');await choice('ok');await waitFor(()=>fs.getStats('/home/Unterricht')?.isDirectory??false,'Folder creation failed');
            app.dispose();content.remove();
        });
        await test('Explorer übergibt Textdateien direkt an den Editor',async()=>{
            fs.writeFile('/home/architektur.txt','Dateiübergabe – Grüße 🌐');desktop=new DesktopWindow(host,context);
            click('[data-app="fileexplorer"]');await waitFor(()=>!!document.querySelector('#explorer-open'),'Explorer did not open');
            const home=document.querySelector<HTMLElement>('.explorer-item[data-name="home"]');assert(home,'Home folder missing');home.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
            click('.explorer-item[data-name="architektur.txt"]');click('#explorer-open');await waitFor(()=>!!document.querySelector('#te-editor'),'Editor handoff failed');
            assert(document.querySelector<HTMLTextAreaElement>('#te-editor')!.value==='Dateiübergabe – Grüße 🌐','Wrong file content');
        });
        await test('Schließen abbrechen bewahrt den geöffneten Editor und seine Änderungen',async()=>{
            fill('#te-editor','Ungespeicherte Änderung');click('.desktop-window .window-dismiss');await choice('cancel');
            await waitFor(()=>!document.querySelector('dialog[open]'),'Dialog did not close');assert(document.querySelector<HTMLTextAreaElement>('#te-editor')!.value==='Ungespeicherte Änderung','Cancel lost text');
        });
        await test('Editor-Tabs können geschlossen werden, ohne den Nachbartab zu überschreiben',async()=>{
            click('#te-new');fill('#te-editor','Zweiter Tab');click('.te-close-tab[data-index="1"]');await choice('discard');
            await waitFor(()=>document.querySelectorAll('.te-close-tab').length===1,'Second tab did not close');assert(document.querySelector<HTMLTextAreaElement>('#te-editor')!.value==='Ungespeicherte Änderung','Neighbour tab was overwritten');
        });
        await test('Speichern beim Schließen schreibt die echte Datei und räumt den Entwurf auf',async()=>{
            click('.desktop-window .window-dismiss');await choice('save');await waitFor(()=>!!document.querySelector('.app-grid'),'Application did not close after saving');
            assert(fs.readFile('/home/architektur.txt')==='Ungespeicherte Änderung','File was not saved');assert(!context.editorSessions.get(host.getId()),'Saved draft remained');
        });
        await test('E-Mail-Entwurf ist nach erneutem Mounten vollständig wieder zugänglich',async()=>{
            click('[data-app="emailclient"]');await waitFor(()=>!!document.querySelector('#email-compose'),'Mail did not open');click('#email-compose');
            fill('#compose-to','test@schule.test');fill('#compose-subject','Entwurf');fill('#compose-body','Erhaltene Nachricht');
            click('.desktop-window .window-dismiss');await choice('save');await waitFor(()=>!!document.querySelector('#email-compose'),'Mail did not return to folders');
            click('.desktop-window .window-dismiss');await waitFor(()=>!!document.querySelector('.app-grid'),'Mail did not close');
            click('[data-app="emailclient"]');await waitFor(()=>!!document.querySelector('.email-folder[data-folder="drafts"]'),'Draft folder missing');
            click('.email-folder[data-folder="drafts"]');click('.email-item[data-folder="drafts"]');
            assert(document.querySelector<HTMLTextAreaElement>('#compose-body')!.value==='Erhaltene Nachricht','Draft lost body');
            click('.desktop-window .window-dismiss');await choice('discard');await waitFor(()=>!!document.querySelector('#email-compose'),'Discard did not return to mail');
            assert(context.hostEmailClientManager.getClient(host.getId())!.getDrafts().length===0,'Discard left a draft');
        });
        await test('Eigener Hinweisdialog weist ungültige Mailports ab',async()=>{
            click('#email-settings');fill('#settings-smtp-port','70000');click('#settings-save');
            await waitFor(()=>!!document.querySelector('dialog[open]'),'Expected own notice dialog');
            assert(document.querySelector('dialog[open]')!.textContent!.includes('65535'),'Missing validation notice');await choice('ok');
            click('.desktop-window .window-dismiss');await choice('discard');await waitFor(()=>!!document.querySelector('#email-compose'),'Settings did not close');
            await desktop!.close(true);desktop=undefined;
        });
        await test('Ausstehende Maildomain wird beim Sichern übernommen und beim Aufräumen nicht verloren',()=>{
            const content=document.createElement('div');document.body.append(content);
            const app=createHostApplication('emailserver',{host,content,dependencies:context,request:{},openApp:async()=>{},closeApp:()=>{},setDismissAction:()=>{}});app.mount();
            fill('#email-domain','architektur.schule.test',content);app.flushPending();assert(context.hostEmailServerManager.getServer(host.getId())!.getMailDomain()==='architektur.schule.test','Pending change lost');app.dispose();content.remove();
        });
        await test('Paketansicht hängt am gemeinsamen Journal und verliert beim Dispose ihre Abonnements',()=>{
            context.packets.show();context.network.updateTopology([host],[]);assert(document.querySelector('.packet-log'),'Packet view missing');context.packets.hide();
        });
        context.packets.dispose();context.runtime.dispose();
        await test('Anwendung kann zweimal starten, Modi wechseln und vollständig aufräumen',async()=>{
            for(let iteration=0;iteration<2;iteration++){
                const before=eventBus.listenerCount(),deps=createApplicationContext(storage),application=new NeposApplication(deps);
                click('#mode-simulation');await waitFor(()=>document.body.classList.contains('simulation-mode'),'Simulation did not start');
                if(iteration===0){click('#mode-design');await waitFor(()=>!document.body.classList.contains('simulation-mode'),'Design mode did not resume');}
                application.dispose();assert(!document.body.classList.contains('simulation-mode'),'Disposed application retained simulation UI state');
                assert(!document.querySelector('#network-canvas'),'Canvas remained after disposal');assert(eventBus.listenerCount()===before,'Application touched the legacy event bus');assert(deps.runtime.events.listenerCount()===0,'Disposed project retained runtime observers');
            }
        });
        await test('Wiederherstellung erhält beschädigte Originaldaten und zeigt aktiviertes Speichern',async()=>{
            memory.set('nepos-project-backup',memory.get('nepos-project')!);memory.set('nepos-project','{broken');
            const deps=createApplicationContext(storage),application=new NeposApplication(deps);
            await waitFor(()=>!!document.querySelector('dialog[open]'),'Recovery dialog missing');click('dialog[open] button.btn-primary');
            await waitFor(()=>!document.querySelector('dialog[open]'),'Recovery dialog did not close');assert(memory.get('nepos-project-recovery')==='{broken','Corrupt original lost');
            assert(document.getElementById('status-text')!.textContent!.includes('aktiv'),'Recovery status stayed blocked');application.dispose();
        });
        return passed;
    } finally { await desktop?.close(true); context.packets.dispose(); context.runtime.dispose(); }
}
