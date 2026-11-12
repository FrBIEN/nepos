import { Kabel } from '../../src/hardware/Kabel';
import '../../src/styles/main.css';
import '../../src/styles/responsive.css';
import { runArchitectureRegressions } from '../architecture.browser';
import { runModemRegressions } from '../modem.browser';
import { createApplicationContext } from '../../src/application/ApplicationContext';
import { NeposApplication } from '../../src/application/NeposApplication';
import { Host } from '../../src/hardware/Host';
import { DesktopWindow } from '../../src/ui/DesktopWindow';
const memory = new Map<string,string>();
const storage = {getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value);},removeItem:(key:string)=>{memory.delete(key);}};
let application: NeposApplication | undefined, desktop: DesktopWindow | undefined;
let context: ReturnType<typeof createApplicationContext> | undefined;
const dispose = async () => { await desktop?.close(true); desktop=undefined; application?.dispose(); application=undefined; context?.packets.dispose(); context?.runtime.dispose(); };
export const browserTests = {
    architecture: runArchitectureRegressions, modem: runModemRegressions,
    async workspace() { await dispose(); memory.clear(); context=createApplicationContext(storage); application=new NeposApplication(context); },
    async explorer() {
        await dispose(); context=createApplicationContext(storage);
        const host=Host.fromJSON({type:'rechner',name:'Dateien',id:'files',installedApps:['fileexplorer','texteditor']},context.runtime);
        desktop=new DesktopWindow(host,context);
        document.querySelector<HTMLElement>('[data-app="fileexplorer"]')!.click();
    },
    async cabledWorkspace() {
        await dispose(); memory.clear(); context=createApplicationContext(storage);
        const a=new Host({type:'rechner',id:'a',position:{x:200,y:180}},context.runtime),b=new Host({type:'rechner',id:'b',position:{x:400,y:180}},context.runtime);
        const cable=new Kabel(undefined,context.runtime);cable.connect({node:a,interface:a.getNetworkInterface(),portIndex:0},true);cable.connect({node:b,interface:b.getNetworkInterface(),portIndex:0},false);
        context.hostFileSystemManager.getOrCreateFileSystem(a).writeFile('/home/keep.txt','Retained data');
        context.store.save(context.scenarios.exportScenario([a,b],[cable],'History',context.services.snapshot([a,b])));application=new NeposApplication(context);
    },
    selectFirst() { const device=context!.network.getHosts()[0];context!.events.emit('device:selected',{device}); },
    content(hostId:string,path:string) {return context?.hostFileSystemManager.getFileSystem(hostId)?.readFile(path);},
    bytes(path:string) { return Array.from(context?.hostFileSystemManager.getFileSystem('files')?.readBytes(path) ?? []); },
    files() { return context?.hostFileSystemManager.getFileSystem('files')?.toJSON(); },
    dispose
};
declare global { interface Window { browserTests: typeof browserTests } }
window.browserTests=browserTests;
void browserTests.workspace();
