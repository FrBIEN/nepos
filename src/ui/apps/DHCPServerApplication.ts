import { HostApplication } from './HostApplication';
import { escapeHTML } from '../html';
export class DHCPServerApplication extends HostApplication {
    mount(): void { this.element.innerHTML = this.createDHCPServerUI(); this.setupDHCPServer(this.element); }
    private createDHCPServerUI(): string {
        const dhcpServer = this.deps.hostDhcpServerManager.getServer(this.host.getId());
        const isRunning = dhcpServer?.isRunning() ?? false;
        const config = dhcpServer?.getConfig();
        const hostIP = this.host.getIP();
        return `
      <div style="display: flex; flex-direction: column; height: 100%; padding: 16px; gap: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; gap: 12px; align-items: center;">
            <span style="font-size: 2rem;">🔄</span>
            <div>
              <div style="font-weight: 600; font-size: 1rem;">DHCP-Server</div>
              <div id="dhcp-status" style="font-size: 0.75rem; color: ${isRunning ? 'var(--success)' : 'var(--text-secondary)'};">${isRunning ? '● Läuft' : '○ Gestoppt'}</div>
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn ${isRunning ? 'btn-danger' : 'btn-success'}" id="dhcp-toggle">${isRunning ? 'Stoppen' : 'Starten'}</button>

          </div>
        </div>

        <div style="flex: 1; display: flex; gap: 16px; overflow: hidden;">
          <div style="flex: 1; background: var(--bg-tertiary); border-radius: 8px; padding: 12px; overflow-y: auto;">
            <div style="font-weight: 600; font-size: 0.875rem; margin-bottom: 12px;">Konfiguration</div>
            <div class="form-group" style="margin-bottom: 8px;">
              <label style="font-size: 0.75rem;">IP-Bereich Start</label>
              <input type="text" id="dhcp-range-start" class="form-control" value="${config?.rangeStart ?? hostIP.replace(/\.\d+$/, '.10')}" style="font-size: 0.8rem;" />
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
              <label style="font-size: 0.75rem;">IP-Bereich Ende</label>
              <input type="text" id="dhcp-range-end" class="form-control" value="${config?.rangeEnd ?? hostIP.replace(/\.\d+$/, '.100')}" style="font-size: 0.8rem;" />
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
              <label style="font-size: 0.75rem;">Subnetzmaske</label>
              <input type="text" id="dhcp-subnet" class="form-control" value="${config?.subnetMask ?? '255.255.255.0'}" style="font-size: 0.8rem;" />
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
              <label style="font-size: 0.75rem;">Gateway (Router)</label>
              <input type="text" id="dhcp-router" class="form-control" value="${config?.router ?? hostIP}" style="font-size: 0.8rem;" />
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
              <label style="font-size: 0.75rem;">DNS-Server</label>
              <input type="text" id="dhcp-dns" class="form-control" value="${config?.dns?.join(', ') ?? hostIP}" style="font-size: 0.8rem;" />
            </div>
          </div>

          <div style="flex: 1; display: flex; flex-direction: column; gap: 12px;">
            <div style="flex: 1; background: var(--bg-tertiary); border-radius: 8px; padding: 12px;">
              <div style="font-weight: 600; font-size: 0.875rem; margin-bottom: 8px;">Aktive Leases</div>
              <div id="dhcp-leases" style="font-size: 0.75rem; max-height: 100px; overflow-y: auto;">
                ${this.renderDHCPLeases()}
              </div>
            </div>

            <div style="flex: 1; background: var(--bg-tertiary); border-radius: 8px; padding: 12px;">
              <div style="font-weight: 600; font-size: 0.875rem; margin-bottom: 8px;">MAC-Reservierungen</div>
              <div id="dhcp-reservations" style="font-size: 0.75rem; max-height: 80px; overflow-y: auto; margin-bottom: 8px;">
                ${this.renderDHCPReservations()}
              </div>
              <div style="display: flex; gap: 4px; font-size: 0.75rem;">
                <input type="text" id="dhcp-res-mac" class="form-control" placeholder="MAC" style="flex: 1; font-size: 0.7rem; padding: 4px;" />
                <input type="text" id="dhcp-res-ip" class="form-control" placeholder="IP" style="flex: 1; font-size: 0.7rem; padding: 4px;" />
                <button class="btn btn-sm btn-primary" id="dhcp-add-res" style="padding: 4px 8px;">+</button>
              </div>
            </div>
          </div>
        </div>

      </div>
    `;
    }
    private renderDHCPLeases(): string {
        const dhcpServer = this.deps.hostDhcpServerManager.getServer(this.host.getId());
        const leases = dhcpServer?.getLeases() ?? [];
        if (leases.length === 0) {
            return '<div style="color: var(--text-secondary);">Keine aktiven Leases</div>';
        }
        return leases.map(lease => `
      <div style="padding: 6px 0; border-bottom: 1px solid var(--border-color);">
        <div style="font-weight: 600;">${lease.ip}</div>
        <div style="color: var(--text-secondary);">MAC: ${lease.mac}</div>
        ${lease.hostname ? `<div style="color: var(--text-secondary);">Host: ${escapeHTML(lease.hostname)}</div>` : ''}
      </div>
    `).join('');
    }
    private renderDHCPReservations(): string {
        const dhcpServer = this.deps.hostDhcpServerManager.getServer(this.host.getId());
        const reservations = dhcpServer?.getReservations() ?? [];
        if (reservations.length === 0) {
            return '<div style="color: var(--text-secondary);">Keine Reservierungen</div>';
        }
        return reservations.map(res => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--border-color);">
        <div>
          <span style="font-weight: 600;">${res.ip}</span>
          <span style="color: var(--text-secondary); margin-left: 6px;">← ${res.mac}</span>
        </div>
        <button class="dhcp-del-res" data-mac="${res.mac}" style="border: none; background: none; color: var(--danger); cursor: pointer; font-size: 0.8rem;">×</button>
      </div>
    `).join('');
    }
    private setupDHCPServer(content: HTMLElement): void {
        const toggleBtn = content.querySelector('#dhcp-toggle') as HTMLButtonElement;
        const statusLabel = content.querySelector('#dhcp-status') as HTMLElement;
        const leasesDiv = content.querySelector('#dhcp-leases') as HTMLElement;
        this.scope.listen(toggleBtn, 'click', () => {
            const rangeStart = (content.querySelector('#dhcp-range-start') as HTMLInputElement).value;
            const rangeEnd = (content.querySelector('#dhcp-range-end') as HTMLInputElement).value;
            const subnetMask = (content.querySelector('#dhcp-subnet') as HTMLInputElement).value;
            const router = (content.querySelector('#dhcp-router') as HTMLInputElement).value;
            const dnsStr = (content.querySelector('#dhcp-dns') as HTMLInputElement).value;
            const dns = dnsStr.split(',').map(s => s.trim()).filter(s => s);
            const dhcpServer = this.deps.hostDhcpServerManager.getOrCreateServer(this.host, {
                rangeStart,
                rangeEnd,
                subnetMask,
                router,
                dns,
                leaseTime: 86400,
            });
            if (dhcpServer.isRunning()) {
                dhcpServer.stop();
                toggleBtn.textContent = 'Starten';
                toggleBtn.classList.remove('btn-danger');
                toggleBtn.classList.add('btn-success');
                statusLabel.textContent = '○ Gestoppt';
                statusLabel.style.color = 'var(--text-secondary)';
            }
            else {
                dhcpServer.start();
                toggleBtn.textContent = 'Stoppen';
                toggleBtn.classList.remove('btn-success');
                toggleBtn.classList.add('btn-danger');
                statusLabel.textContent = '● Läuft';
                statusLabel.style.color = 'var(--success)';
            }
        });
        // MAC Reservations
        const addResBtn = content.querySelector('#dhcp-add-res') as HTMLButtonElement;
        const resMacInput = content.querySelector('#dhcp-res-mac') as HTMLInputElement;
        const resIpInput = content.querySelector('#dhcp-res-ip') as HTMLInputElement;
        const reservationsDiv = content.querySelector('#dhcp-reservations') as HTMLElement;
        const refreshReservations = () => {
            if (reservationsDiv) {
                reservationsDiv.innerHTML = this.renderDHCPReservations();
                this.setupReservationDeleteHandlers(content);
            }
        };
        this.scope.listen(addResBtn, 'click', () => {
            const mac = resMacInput?.value.trim();
            const ip = resIpInput?.value.trim();
            // Use getOrCreateServer to ensure we can configure it even if stopped
            const dhcpServer = this.deps.hostDhcpServerManager.getOrCreateServer(this.host);
            if (mac && ip) {
                dhcpServer.addReservation(mac, ip);
                resMacInput.value = '';
                resIpInput.value = '';
                refreshReservations();
            }
        });
        this.setupReservationDeleteHandlers(content);
        // Update leases periodically
        const interval = this.scope.interval(() => {
            if (leasesDiv) {
                leasesDiv.innerHTML = this.renderDHCPLeases();
            }
        }, 2000);
        this.scope.add(() => clearInterval(interval));
    }
    private setupReservationDeleteHandlers(content: HTMLElement): void {
        content.querySelectorAll('.dhcp-del-res').forEach(btn => {
            this.scope.listen(btn, 'click', () => {
                const mac = (btn as HTMLElement).dataset.mac;
                const dhcpServer = this.deps.hostDhcpServerManager.getServer(this.host.getId());
                if (mac && dhcpServer) {
                    dhcpServer.removeReservation(mac);
                    const reservationsDiv = content.querySelector('#dhcp-reservations') as HTMLElement;
                    if (reservationsDiv) {
                        reservationsDiv.innerHTML = this.renderDHCPReservations();
                        this.setupReservationDeleteHandlers(content);
                    }
                }
            });
        });
    }
}
