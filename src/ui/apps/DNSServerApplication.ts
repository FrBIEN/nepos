import { HostApplication } from './HostApplication';
import { escapeHTML } from '../html';
import { DNSRecordType, type DNSRecord } from '../../apps/DNS';
export class DNSServerApplication extends HostApplication {
    mount(): void { this.element.innerHTML = this.createDNSServerUI(); this.setupDNSServer(this.element); }
    private createDNSServerUI(): string {
        const dnsServer = this.deps.hostDnsServerManager.getServer(this.host.getId());
        const isRunning = dnsServer?.isRunning() ?? false;
        return `
      <div style="display: flex; flex-direction: column; height: 100%; padding: 16px; gap: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; gap: 12px; align-items: center;">
            <span style="font-size: 2rem;">📖</span>
            <div>
              <div style="font-weight: 600; font-size: 1rem;">DNS-Server</div>
              <div id="dns-status" style="font-size: 0.75rem; color: ${isRunning ? 'var(--success)' : 'var(--text-secondary)'};">${isRunning ? '● Läuft (Port 53)' : '○ Gestoppt'}</div>
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn ${isRunning ? 'btn-danger' : 'btn-success'}" id="dns-toggle">${isRunning ? 'Stoppen' : 'Starten'}</button>

          </div>
        </div>

        <div style="flex: 1; background: var(--bg-tertiary); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="font-weight: 600; font-size: 0.875rem;">DNS-Einträge</div>
            <button class="btn btn-sm btn-primary" id="dns-add-record">+ Eintrag</button>
          </div>
          <div id="dns-records" style="font-size: 0.75rem; max-height: 250px; overflow-y: auto;">
            ${this.renderDNSRecords()}
          </div>
        </div>

        <div style="background: var(--bg-tertiary); border-radius: 8px; padding: 12px;">
          <div style="font-weight: 600; font-size: 0.875rem; margin-bottom: 8px;">Eintrag hinzufügen</div>
          <div style="display: flex; gap: 8px; align-items: flex-end;">
             <div class="form-group" style="width: 80px; margin-bottom: 0;">
              <label style="font-size: 0.7rem;">Typ</label>
              <select id="dns-type" class="form-control" style="font-size: 0.8rem; padding: 4px;">
                <option value="${DNSRecordType.A}">A</option>
                <option value="${DNSRecordType.MX}">MX</option><option value="5">CNAME</option><option value="2">NS</option><option value="12">PTR</option><option value="16">TXT</option>
              </select>
            </div>
            <div class="form-group" style="flex: 1; margin-bottom: 0;">
              <label style="font-size: 0.7rem;">Name (Domain)</label>
              <input type="text" id="dns-hostname" class="form-control" placeholder="www.example.de" style="font-size: 0.8rem;" />
            </div>
            <div class="form-group" style="flex: 1; margin-bottom: 0;">
              <label style="font-size: 0.7rem;">Wert (IP / Mailserver)</label>
              <input type="text" id="dns-value" class="form-control" placeholder="192.168.0.10" style="font-size: 0.8rem;" />
            </div>
            <button class="btn btn-primary btn-sm" id="dns-save-record">Hinzufügen</button>
          </div>
        </div>

      </div>
    `;
    }
    private renderDNSRecords(): string {
        const dnsServer = this.deps.hostDnsServerManager.getOrCreateServer(this.host);
        // Flatten records
        const allRecords: {
            record: DNSRecord;
        }[] = [];
        if (dnsServer) {
            dnsServer.getAllRecords().forEach(r => allRecords.push({ record: r }));
        }
        if (allRecords.length === 0) {
            return '<div style="color: var(--text-secondary);">Keine DNS-Einträge vorhanden</div>';
        }
        // Sort logic could go here
        return allRecords.map(item => {
            const r = item.record;
            const typeStr = r.type === DNSRecordType.MX ? 'MX' : 'A';
            return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-color);">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="background: #e5e7eb; color: #374151; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; width: 30px; text-align: center;">${typeStr}</span>
          <div>
            <span style="font-weight: 600;">${escapeHTML(r.name)}</span>
            <span style="color: var(--text-secondary); margin-left: 8px;">→ ${escapeHTML(r.value)}</span>
          </div>
        </div>
        <button class="dns-delete-record" data-name="${escapeHTML(r.name)}" data-type="${r.type}" style="border: none; background: none; color: var(--danger); cursor: pointer;">×</button>
      </div>
    `;
        }).join('');
    }
    private setupDNSServer(content: HTMLElement): void {
        const toggleBtn = content.querySelector('#dns-toggle') as HTMLButtonElement;
        const statusLabel = content.querySelector('#dns-status') as HTMLElement;
        const recordsDiv = content.querySelector('#dns-records') as HTMLElement;
        const saveRecordBtn = content.querySelector('#dns-save-record') as HTMLButtonElement;
        const hostnameInput = content.querySelector('#dns-hostname') as HTMLInputElement;
        const valueInput = content.querySelector('#dns-value') as HTMLInputElement;
        const typeInput = content.querySelector('#dns-type') as HTMLSelectElement;
        // Remove "Add Record" button from header since form is always visible
        const headerAddBtn = content.querySelector('#dns-add-record') as HTMLButtonElement;
        if (headerAddBtn)
            headerAddBtn.style.display = 'none';
        this.scope.listen(toggleBtn, 'click', () => {
            // Use getOrCreate to ensure we have a server instance to start/stop
            const dnsServer = this.deps.hostDnsServerManager.getOrCreateServer(this.host);
            if (dnsServer.isRunning()) {
                dnsServer.stop();
                toggleBtn.textContent = 'Starten';
                toggleBtn.classList.remove('btn-danger');
                toggleBtn.classList.add('btn-success');
                statusLabel.textContent = '○ Gestoppt';
                statusLabel.style.color = 'var(--text-secondary)';
            }
            else {
                dnsServer.start();
                toggleBtn.textContent = 'Stoppen';
                toggleBtn.classList.remove('btn-success');
                toggleBtn.classList.add('btn-danger');
                statusLabel.textContent = '● Läuft (Port 53)';
                statusLabel.style.color = 'var(--success)';
            }
        });
        this.scope.listen(saveRecordBtn, 'click', () => {
            const hostname = hostnameInput.value.trim();
            const value = valueInput.value.trim();
            const type = parseInt(typeInput.value, 10) as DNSRecordType;
            if (hostname && value) {
                const dnsServer = this.deps.hostDnsServerManager.getOrCreateServer(this.host);
                dnsServer.addRecord({
                    name: hostname,
                    type: type,
                    ttl: 86400,
                    value: value,
                });
                hostnameInput.value = '';
                valueInput.value = ''; // Keep type selected
                recordsDiv.innerHTML = this.renderDNSRecords();
                this.setupDNSDeleteButtons(content);
            }
        });
        this.setupDNSDeleteButtons(content);
    }
    private setupDNSDeleteButtons(content: HTMLElement): void {
        content.querySelectorAll('.dns-delete-record').forEach(btn => {
            this.scope.listen(btn, 'click', () => {
                const name = (btn as HTMLElement).dataset.name;
                const type = parseInt((btn as HTMLElement).dataset.type || '1', 10) as DNSRecordType;
                if (name) {
                    const dnsServer = this.deps.hostDnsServerManager.getServer(this.host.getId());
                    dnsServer?.removeRecord(name, type);
                    const recordsDiv = content.querySelector('#dns-records') as HTMLElement;
                    recordsDiv.innerHTML = this.renderDNSRecords();
                    this.setupDNSDeleteButtons(content);
                }
            });
        });
    }
}
