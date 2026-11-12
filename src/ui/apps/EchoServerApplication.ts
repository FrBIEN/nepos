import { HostApplication } from './HostApplication';
export class EchoServerApplication extends HostApplication {
    mount(): void { this.element.innerHTML = this.createEchoServerUI(); this.setupEchoServer(this.element); }
    private createEchoServerUI(): string {
        const server = this.deps.hostEchoServerManager.getOrCreateServer(this.host);
        const isRunning = server.isRunning();
        const btnClass = isRunning ? 'btn-danger' : 'btn-success';
        const btnText = isRunning ? 'Stoppen' : 'Starten';
        const statusText = isRunning ? '● Läuft' : '○ Gestoppt';
        const statusColor = isRunning ? 'var(--success)' : 'var(--text-secondary)';
        return `
      <div style="padding: 20px; display: flex; flex-direction: column; height: 100%;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h2 style="font-weight: 400; margin: 0;">Echo-Server</h2>

        </div>
        <div style="background: var(--bg-secondary); padding: 20px; border-radius: 8px; max-width: 400px;">
          <div class="form-group">
            <label>Port</label>
            <input type="number" id="echo-port" class="form-control" value="${server.getPort()}" ${isRunning ? 'disabled' : ''}>
          </div>
          <div style="margin-top: 20px; display: flex; align-items: center; justify-content: space-between;">
            <div style="font-weight: 600; color: ${statusColor};" id="echo-status">${statusText}</div>
            <button id="echo-toggle" class="btn ${btnClass}">${btnText}</button>
          </div>
          <p style="margin-top: 16px; color: var(--text-secondary); font-size: 0.9rem;">
            Der Echo-Server sendet alle empfangenen Daten direkt an den Absender zurück.
          </p>
          <div id="echo-messages" style="margin-top: 10px; height: 150px; background: #000; color: #0f0; padding: 10px; overflow-y: auto; font-family: monospace; font-size: 0.8rem; border-radius: 4px;"></div>
        </div>
      </div>
    `;
    }
    private setupEchoServer(content: HTMLElement): void {
        const toggleBtn = content.querySelector('#echo-toggle') as HTMLButtonElement;
        const statusLabel = content.querySelector('#echo-status') as HTMLElement;
        const portInput = content.querySelector('#echo-port') as HTMLInputElement;
        const messagesDiv = content.querySelector('#echo-messages') as HTMLElement;
        const log = (msg: string) => {
            if (messagesDiv) {
                const div = document.createElement('div');
                div.textContent = `> ${msg}`;
                messagesDiv.appendChild(div);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }
        };
        // Update running server instance with log callback
        const currentServer = this.deps.hostEchoServerManager.getServer(this.host.getId());
        if (currentServer) {
            this.scope.add(currentServer.onMessage(log));
        }
        this.scope.listen(toggleBtn, 'click', () => {
            const port = parseInt(portInput.value.trim(), 10) || 55555;
            const server = this.deps.hostEchoServerManager.getOrCreateServer(this.host, port);
            this.scope.add(server.onMessage(log)); // Ensure callback is set
            if (server.isRunning()) {
                server.stop();
                toggleBtn.textContent = 'Starten';
                toggleBtn.classList.remove('btn-danger');
                toggleBtn.classList.add('btn-success');
                statusLabel.textContent = '○ Gestoppt';
                statusLabel.style.color = 'var(--text-secondary)';
                portInput.disabled = false;
            }
            else {
                server.start();
                if (!server.isRunning()) {
                    void this.showNotice('Server konnte nicht starten. Port oder Konfiguration prüfen.');
                    return;
                }
                toggleBtn.textContent = 'Stoppen';
                toggleBtn.classList.remove('btn-success');
                toggleBtn.classList.add('btn-danger');
                statusLabel.textContent = '● Läuft';
                statusLabel.style.color = 'var(--success)';
                portInput.disabled = true;
            }
        });
    }
}
