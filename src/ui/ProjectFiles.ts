import { bindDialogLifetime } from './Dialogs';
import type { ScenarioData } from '../scenario/ScenarioTypes';
import { addDialogDismiss } from './DismissButton';
import { decodeProject, encodeProject, type DecodedProject, type ProjectFormat } from '../scenario/ProjectCodec';
/** Browser file I/O only; the project codec has no access to application state. */
export function chooseProject(signal?:AbortSignal): Promise<DecodedProject> {
    return new Promise((resolve, reject) => {
        if(signal?.aborted){reject(new DOMException('Abgebrochen','AbortError'));return;}
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.fls,.json';
        input.hidden = true;
        document.body.append(input);
        const abort=()=>{input.remove();reject(new DOMException('Abgebrochen','AbortError'));};
        signal?.addEventListener('abort',abort,{once:true});
        const cleanup=()=>{input.remove();signal?.removeEventListener('abort',abort);};
        input.addEventListener('cancel', () => { cleanup(); reject(new DOMException('Keine Datei ausgewählt', 'AbortError')); }, { once: true });
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            cleanup();
            if (!file) {
                reject(new DOMException('Keine Datei ausgewählt', 'AbortError'));
                return;
            }
            try {
                if (file.size > 50 * 1024 * 1024)
                    throw new Error('Projektdatei überschreitet 50 MB');
                resolve(await decodeProject(new Uint8Array(await file.arrayBuffer()), file.name));
            }
            catch (error) {
                reject(error);
            }
        }, { once: true });
        input.click();
    });
}
export function downloadProject(scenario: ScenarioData,signal?:AbortSignal): void {
    if(signal?.aborted)return;
    const urls:string[]=[];
    const dialog=document.createElement('dialog');dialog.className='filius-dialog';dialog.setAttribute('aria-label','Projekt speichern');
    const heading=document.createElement('h2');heading.textContent='Projekt speichern';
    const format=document.createElement('select');format.className='form-control';format.setAttribute('aria-label','Projektformat');
    for(const [value,label]of [['fls','Filius (.fls)'],['json','Nepos (.json)']]){const option=document.createElement('option');option.value=value;option.textContent=label;format.append(option);}
    const content=document.createElement('div');
    const render=()=>{
        const result=encodeProject(scenario,format.value as ProjectFormat),url=URL.createObjectURL(new Blob([result.bytes],{type:result.mimeType}));urls.push(url);
        const link=document.createElement('a');link.className='btn btn-primary';link.href=url;link.download=`${(scenario.name||'Nepos-Netzwerk').replace(/[^\p{L}\p{N}_-]/gu,'_')}.${format.value}`;link.textContent='Herunterladen';
        const filename=document.createElement('p');filename.textContent=link.download;
        const actions=document.createElement('div');actions.className='dialog-actions';actions.append(link);content.replaceChildren(filename);
        if(result.warnings.length){const list=document.createElement('ul');for(const warning of result.warnings){const item=document.createElement('li');item.textContent=warning;list.append(item);}content.append(list);}
        if(format.value==='fls'){
            const notice=document.createElement('p');notice.setAttribute('role','note');
            notice.textContent='Diese Datei erhält den vollständigen Nepos-Zustand in Zusatzdaten. Java-Filius nutzt die kompatible Netzwerkkonfiguration; genannte Erweiterungen sind dort nicht vollständig verfügbar. Beim erneuten Speichern in Java-Filius können die Nepos-Zusatzdaten verloren gehen. Bewahren Sie deshalb diese Originaldatei oder zusätzlich eine Nepos-JSON-Datei auf.';
            content.append(notice);
        }
        if(format.value==='json'){
            const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='JSON anzeigen / kopieren';
            const text=document.createElement('textarea');text.readOnly=true;text.className='form-control';text.setAttribute('aria-label','Projekt-JSON');text.value=new TextDecoder().decode(result.bytes);
            const copy=document.createElement('button');copy.className='btn';copy.textContent='JSON kopieren';copy.onclick=async()=>{try{await navigator.clipboard.writeText(text.value);copy.textContent='Kopiert';}catch{text.focus();text.select();copy.textContent='Text auswählen und kopieren';}};
            details.append(summary,text,copy);content.append(details);
        }
        content.append(actions);
    };
    format.onchange=()=>{try{render();}catch(error){const message=document.createElement('p');message.setAttribute('role','alert');message.textContent=error instanceof Error?error.message:String(error);content.replaceChildren(message);}};render();dialog.append(heading,format,content);addDialogDismiss(dialog);
    dialog.addEventListener('close',()=>{dialog.remove();setTimeout(()=>urls.forEach(url=>URL.revokeObjectURL(url)),60000);},{once:true});document.body.append(dialog);dialog.showModal();bindDialogLifetime(dialog,signal);
}
export function showProjectRecovery(message: string, documents: {name: string; label?: string; content: string}[], resume?: () => boolean,signal?:AbortSignal): void {
    if(signal?.aborted)return;
    const dialog=document.createElement('dialog');dialog.className='filius-dialog';dialog.setAttribute('aria-label','Projekt wiederherstellen');
    const heading=document.createElement('h2');heading.textContent='Projekt wiederherstellen';
    const explanation=document.createElement('p');explanation.textContent=message;
    const urls: string[]=[];const links=document.createElement('div');links.className='dialog-actions';
    for(const source of documents){
        const link=document.createElement('a');link.className='btn';link.textContent=(source.label ?? source.name)+' sichern';link.download=source.name;
        link.href=URL.createObjectURL(new Blob([source.content],{type:'application/json'}));urls.push(link.href);links.append(link);
    }
    dialog.append(heading,explanation,links);
    if(resume){const button=document.createElement('button');button.className='btn btn-primary';button.textContent='Wiederhergestelltes Projekt weiterverwenden';button.onclick=()=>{if(resume())dialog.close();};dialog.append(button);}
    addDialogDismiss(dialog);dialog.addEventListener('close',()=>{dialog.remove();setTimeout(()=>urls.forEach(url=>URL.revokeObjectURL(url)),60000);},{once:true});
    document.body.append(dialog);dialog.showModal();bindDialogLifetime(dialog,signal);
}
export function showProjectNotices(warnings: string[], title='Hinweise zur Filius-Kompatibilität',signal?:AbortSignal): void {
    if (!warnings.length||signal?.aborted)
        return;
    const dialog = document.createElement('dialog');
    dialog.className = 'filius-dialog';
    dialog.setAttribute('aria-label', title);
    const heading = document.createElement('h2');
    heading.textContent = title;
    const list = document.createElement('ul');
    for (const warning of warnings) {
        const row = document.createElement('li');
        row.textContent = warning;
        list.append(row);
    }
    dialog.append(heading, list);
    addDialogDismiss(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();bindDialogLifetime(dialog,signal);
}
