import { HostApplication } from './HostApplication';
import { SimpleClient } from '../../apps/SimpleClient';
export class SimpleClientApplication extends HostApplication {
    mount(): void { this.element.innerHTML = this.createSimpleClientUI(); this.setupSimpleClient(this.element); }
    private createSimpleClientUI(): string {
        return `
      <div style="display: flex; flex-direction: column; height: 100%; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="font-weight: 400; margin: 0;">Einfacher Client</h2>

        </div>

        <div style="display: flex; gap: 10px; margin-bottom: 10px;">
             <input type="text" id="client-ip" class="form-control" placeholder="IP-Adresse" style="flex: 2;">
             <input type="number" id="client-port" class="form-control" placeholder="Port" value="55555" style="flex: 1;">
             <button id="client-connect" class="btn btn-primary" style="flex: 1;">Verbinden</button>
        </div>

        <div id="client-status" style="margin-bottom: 10px; font-size: 0.9rem; color: var(--text-secondary);">Nicht verbunden</div>

        <div style="flex: 1; display: flex; flex-direction: column; background: var(--bg-secondary); border-radius: 8px; overflow: hidden; margin-bottom: 10px;">
            <div id="client-messages" style="flex: 1; padding: 10px; overflow-y: auto; font-family: monospace;"></div>
            <div style="display: flex; padding: 10px; border-top: 1px solid var(--border-color);">
                <input type="text" id="client-msg" class="form-control" placeholder="Nachricht..." style="flex: 1; margin-right: 10px;">
                <button id="client-send" class="btn btn-secondary">Senden</button>
            </div>
        </div>
      </div>
     `;
    }
    private setupSimpleClient(content: HTMLElement): void {
        const client = new SimpleClient(this.host);
        this.scope.add(() => client.disconnect());
        const messagesDiv = content.querySelector('#client-messages') as HTMLElement;
        const connectBtn = content.querySelector('#client-connect') as HTMLButtonElement;
        const sendBtn = content.querySelector('#client-send') as HTMLButtonElement;
        const statusLabel = content.querySelector('#client-status') as HTMLElement;
        const ipInput = content.querySelector('#client-ip') as HTMLInputElement;
        const portInput = content.querySelector('#client-port') as HTMLInputElement;
        const msgInput = content.querySelector('#client-msg') as HTMLInputElement;
        let isConnected = false;
        const log = (msg: string, type: 'in' | 'out' | 'sys' = 'sys') => {
            const div = document.createElement('div');
            div.style.marginBottom = '4px';
            if (type === 'in')
                div.style.color = 'var(--success)';
            if (type === 'out')
                div.style.color = 'var(--primary)';
            if (type === 'sys')
                div.style.color = 'var(--text-secondary)';
            div.textContent = (type === 'in' ? '< ' : type === 'out' ? '> ' : '') + msg;
            messagesDiv.appendChild(div);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        };
        client.onStatus((status) => {
            statusLabel.textContent = status;
            if (status.includes('Verbunden')) {
                connectBtn.textContent = 'Trennen';
                connectBtn.classList.remove('btn-primary');
                connectBtn.classList.add('btn-danger');
                isConnected = true;
            }
            else if (status.includes('Getrennt') || status.includes('Fehler')) {
                connectBtn.textContent = 'Verbinden';
                connectBtn.classList.remove('btn-danger');
                connectBtn.classList.add('btn-primary');
                isConnected = false;
            }
        });
        client.onReceive((msg) => {
            log(msg, 'in');
        });
        this.scope.listen(connectBtn, 'click', () => {
            if (isConnected) {
                client.disconnect();
            }
            else {
                const ip = ipInput.value.trim();
                const port = parseInt(portInput.value.trim(), 10) || 55555;
                if (ip) {
                    client.connect(ip, port);
                }
            }
        });
        const sendMessage = () => {
            const msg = msgInput.value;
            if (msg) {
                client.send(msg);
                log(msg, 'out');
                msgInput.value = '';
            }
        };
        this.scope.listen(sendBtn, 'click', sendMessage);
        this.scope.listen(msgInput, 'keydown', (e) => {
            if (e.key === 'Enter')
                sendMessage();
        });
    }
}
