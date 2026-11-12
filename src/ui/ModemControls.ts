import { Lifetime } from '../core/Lifetime';
import { showNotice } from './Dialogs';
import { Modem } from '../hardware/Modem';

/** Signaling uses the real Internet; simulated frames remain on the WebRTC channel. */
export function bindModemControls(device: Modem, container: HTMLElement, scope: Lifetime): void {
    const root = container.firstElementChild;
    const field = <T extends HTMLElement>(id: string) => root?.parentElement === container ? container.querySelector<T>(`#${id}`) : null;
    const visible = (id: string) => { const element=field(id); if(element)element.style.display='block'; };
    const hide = (id: string) => { const element=field(id); if(element)element.style.display='none'; };
    const tokenOutput = async (id: string, token: string, feedback: string) => {
        const output=field<HTMLTextAreaElement>(id); if(!output)return;
        output.value=token;output.style.display='block';output.select();
        const status=field(feedback);if(!status)return;
        try { await navigator.clipboard.writeText(token);status.textContent='Token in die Zwischenablage kopiert'; }
        catch { status.textContent='Token markieren und kopieren'; }
        status.style.display='block';
    };
    const action = (id: string, run: () => Promise<void>) => scope.listen(field<HTMLButtonElement>(id), 'click', async () => {
        const button=field<HTMLButtonElement>(id)!;button.disabled=true;
        try { await run(); } catch(error) { device.log(String(error)); void showNotice(String(error),scope.signal); }
        finally { if(button.isConnected)button.disabled=false; }
    });
    for(const mode of ['manual','auto'])scope.listen(field(`modem-mode-${mode}`), 'click',()=>{
        for(const other of ['manual','auto']){
            const panel=field(`modem-panel-${other}`),button=field(`modem-mode-${other}`);
            if(panel)panel.style.display=mode===other?'block':'none';
            if(button){button.style.background=mode===other?'var(--bg-primary)':'transparent';button.style.color=mode===other?'var(--primary)':'var(--text-primary)';}
        }
    });
    action('modem-create-offer',async()=>{
        device.cancelSignaling();const token=await device.createOffer();
        await tokenOutput('modem-offer-out',token,'modem-offer-copy-feedback');
        for(const id of ['modem-answer-section','modem-answer-in','modem-finalize'])visible(id);hide('modem-answer-out');
    });
    action('modem-accept-offer',async()=>{
        const token=field<HTMLTextAreaElement>('modem-offer-in')?.value.trim();if(!token)return;
        device.cancelSignaling();const answer=await device.acceptOffer(token);visible('modem-answer-section');
        await tokenOutput('modem-answer-out',answer,'modem-answer-copy-feedback');
    });
    action('modem-finalize',async()=>{const token=field<HTMLTextAreaElement>('modem-answer-in')?.value.trim();if(token)await device.finalizeConnection(token);});
    scope.listen(field('modem-disconnect'), 'click',()=>{device.cancelSignaling();device.disconnect();hide('modem-auto-host-status');});
    const url = (action: string, id?: string) => {
        const endpoint=new URL(field<HTMLInputElement>('modem-server-url')?.value || '',location.href);
        if(!['http:','https:'].includes(endpoint.protocol))throw new Error('Signaling benötigt eine HTTP(S)-Adresse');
        endpoint.searchParams.set('action',action);if(id)endpoint.searchParams.set('id',id);return endpoint;
    };
    const start = () => {device.cancelSignaling();return device.beginSignaling();};
    const request = async (address: URL, signal: AbortSignal, body?: string) => {
        const response=await fetch(address,{method:body===undefined?'GET':'POST',body,signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
        if(!response.ok)throw new Error(`Signaling-Server: HTTP ${response.status}`);return response;
    };
    action('modem-auto-host',async()=>{
        const controller=start(),deadline=Date.now()+600000;
        try {
            const endpoint=url('offer'),token=await device.createOffer();
            const response=await request(endpoint,controller.signal,token),session=await response.json();
            if(typeof session.id!=='string'||!/^[a-f0-9]{32}$/.test(session.id))throw new Error('Ungültige Sitzungskennung');
            visible('modem-auto-host-status');const id=field('modem-session-id');if(id)id.textContent=session.id;
            const answerURL=new URL(endpoint);answerURL.searchParams.set('action','answer');answerURL.searchParams.set('id',session.id);
            device.log('Warte auf Partner (höchstens 10 Minuten)');
            while(!controller.signal.aborted && device.getStatus()==='connecting'){
                if(Date.now()>deadline)throw new Error('Warten auf Partner: Zeitüberschreitung');
                const answer=await request(answerURL,controller.signal);
                if(answer.status!==204){await device.finalizeConnection(await answer.text());return;}
                await new Promise<void>((resolve,reject)=>{
                    const abort=()=>{clearTimeout(timer);reject(new DOMException('Abgebrochen','AbortError'));};
                    const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',abort);resolve();},2000);
                    controller.signal.addEventListener('abort',abort,{once:true});
                });
            }
        } catch(error) {if(!controller.signal.aborted){device.disconnect();throw error;}}
        finally {device.finishSignaling(controller);}
    });
    action('modem-auto-join',async()=>{
        const id=field<HTMLInputElement>('modem-join-id')?.value.trim();if(!id)return;
        if(!/^[a-f0-9]{32}$/.test(id))throw new Error('Sitzungskennung: 32 hexadezimale Zeichen erforderlich');
        const controller=start();
        try {
            const endpoint=url('offer',id),offer=await (await request(endpoint,controller.signal)).text();
            const answer=await device.acceptOffer(offer);endpoint.searchParams.set('action','answer');
            await request(endpoint,controller.signal,answer);device.log('Antwort gesendet. Warte auf Datenkanal.');
        } catch(error) {if(!controller.signal.aborted){device.disconnect();throw error;}}
        finally {device.finishSignaling(controller);}
    });
}
