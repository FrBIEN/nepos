import { HostApplication } from './HostApplication';
import { escapeHTML } from '../html';
export class WebServerApplication extends HostApplication {
    mount(): void { this.element.innerHTML = this.createWebServerUI(); this.setupWebServer(this.element); }
    private createWebServerUI(): string {
        const server = this.deps.hostServerManager.getOrCreateServer(this.host);
        const isRunning = server.isRunning();
        return `
      <div style="display: flex; flex-direction: column; height: 100%;">
        <div style="padding: 12px; background: var(--bg-tertiary); border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong>Webserver</strong>
            <span id="ws-status" style="margin-left: 12px;">${isRunning ? '🟢 Läuft' : '🔴 Gestoppt'}</span>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-sm ${isRunning ? 'btn-danger' : 'btn-primary'}" id="ws-toggle">
              ${isRunning ? '⏹ Stoppen' : '▶ Starten'}
            </button>
            <button class="btn btn-sm btn-secondary" id="ws-clear-log">Log löschen</button>

          </div>
        </div>
        <div style="padding: 8px 12px; background: var(--bg-secondary); border-bottom: 1px solid var(--border-color); font-size: 0.75rem;">
          URL: <code>http://${this.host.getIP()}/</code>
        </div>
        <div style="flex: 1; overflow: auto; font-family: monospace; font-size: 0.75rem; padding: 8px;">
          <div id="ws-access-log" style="white-space: pre-wrap;"></div>
        </div>
      </div>
    `;
    }
    private setupWebServer(content: HTMLElement): void {
        const server = this.deps.hostServerManager.getOrCreateServer(this.host);
        const statusLabel = content.querySelector('#ws-status') as HTMLElement;
        const toggleBtn = content.querySelector('#ws-toggle') as HTMLButtonElement;
        const clearLogBtn = content.querySelector('#ws-clear-log') as HTMLButtonElement;
        const accessLog = content.querySelector('#ws-access-log') as HTMLElement;
        const updateLog = () => {
            const entries = server.getAccessLog();
            if (entries.length === 0) {
                accessLog.textContent = 'Noch keine Zugriffe.\n\nStarte den Server und öffne einen Webbrowser auf einem anderen Gerät,\num auf http://' + this.host.getIP() + '/ zuzugreifen.';
            }
            else {
                accessLog.innerHTML = entries.map(e => {
                    const time = e.timestamp.toLocaleTimeString('de-DE');
                    const statusColor = e.status < 400 ? '#22c55e' : '#ef4444';
                    return `<div>[${time}] <span style="color:${statusColor}">${e.status}</span> ${e.method} ${escapeHTML(e.path)} - ${e.clientIP} (${e.size} bytes)</div>`;
                }).join('');
            }
        };
        this.scope.listen(toggleBtn, 'click', () => {
            if (server.isRunning()) {
                server.stop();
                toggleBtn.textContent = '▶ Starten';
                toggleBtn.classList.remove('btn-danger');
                toggleBtn.classList.add('btn-primary');
                statusLabel.textContent = '🔴 Gestoppt';
            }
            else {
                server.start();
                if (!server.isRunning()) {
                    void this.showNotice('Server konnte nicht starten. Port oder Konfiguration prüfen.');
                    return;
                }
                toggleBtn.textContent = '⏹ Stoppen';
                toggleBtn.classList.remove('btn-primary');
                toggleBtn.classList.add('btn-danger');
                statusLabel.textContent = '🟢 Läuft';
            }
        });
        this.scope.listen(clearLogBtn, 'click', () => {
            server.clearAccessLog();
            updateLog();
        });
        // Update log periodically
        updateLog();
        const interval = this.scope.interval(updateLog, 1000);
        this.scope.add(() => clearInterval(interval));
    }
}
