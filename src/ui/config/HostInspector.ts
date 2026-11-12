import { Inspector } from './Inspector';
import { escapeHTML } from '../../ui/html';
import { i18n } from '../../i18n';
import { Host, Switch } from '../../hardware';
export class HostInspector extends Inspector {
    render(device: Host, content: HTMLElement): void {
        const title = document.getElementById('config-title');
        const readOnly = this.context.isSimulation();
        const iface = device.getNetworkInterface();
        const isConnected = iface.isConnected();
        const dhcpEnabled = iface.isDHCPEnabled();
        const ro = readOnly ? 'readonly style="opacity: 0.7"' : '';
        const dhcpRo = (readOnly || dhcpEnabled) ? 'readonly style="opacity: 0.7"' : '';
        const disabled = readOnly ? 'disabled' : '';
        content.innerHTML = `
          <div class="config-section">
            <div class="config-section-title">Netzwerk</div>
            <div class="form-group"><label for="cfg-name">Name</label><input id="cfg-name" class="form-control" value="${escapeHTML(device.getName())}" ${ro}/></div>
            ${this.context.isSimulation() ? '<button id="cfg-desktop" class="btn btn-primary">Anwendungen öffnen</button>' : ''}
            <div class="form-group">
                <label>Farbe (Datenpakete)</label>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <input type="color" id="cfg-color" value="${(device as Host).getColor ? (device as Host).getColor() : '#22c55e'}" style="width: 40px; height: 30px; padding: 0; border: none; cursor: pointer;" ${disabled} />
                    <span style="font-size: 0.8rem; color: var(--text-secondary);">${(device as Host).getColor ? (device as Host).getColor() : '#22c55e'}</span>
                </div>
            </div>
            <div class="form-group checkbox-group" style="${readOnly ? 'opacity: 0.7' : ''}">
              <input type="checkbox" id="cfg-dhcp" ${dhcpEnabled ? 'checked' : ''} ${disabled} />
              <label for="cfg-dhcp">${i18n.t('config.useDHCP')}</label>
            </div>
            ${dhcpEnabled ? `<div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 12px;">💡 Im Simulationsmodus: Terminal öffnen → <code>dhcp</code> eingeben</div>` : ''}

            <div class="form-group">
              <label>${i18n.t('config.ipAddress')}</label>
              <input type="text" id="cfg-ip" class="form-control" value="${iface.getIP()}" ${dhcpRo} />
            </div>
            <div class="form-group">
              <label>${i18n.t('config.subnetMask')}</label>
              <input type="text" id="cfg-subnet" class="form-control" value="${iface.getSubnetMask()}" ${dhcpRo} />
            </div>
            <div class="form-group">
              <label>${i18n.t('config.gateway')}</label>
              <input type="text" id="cfg-gateway" class="form-control" value="${iface.getGateway()}" placeholder="z.B. 192.168.0.1" ${dhcpRo} />
            </div>
            <div class="form-group">
              <label>${i18n.t('config.dns')}</label>
              <input type="text" id="cfg-dns" class="form-control" value="${iface.getDNS()}" placeholder="z.B. 8.8.8.8" ${dhcpRo} />
            </div>
          </div>
          <div class="config-section"><div class="config-section-title">Verbindung</div><label class="checkbox-group"><input type="checkbox" id="cfg-wireless" ${device.getWireless().enabled ? 'checked' : ''} ${readOnly ? 'disabled' : ''}> WLAN verwenden</label><label for="cfg-ssid">WLAN / SSID</label><select id="cfg-ssid" class="form-control" ${readOnly ? 'disabled' : ''}><option value="">WLAN auswählen</option>${(this.context.nodes() || []).filter((n): n is Switch => n instanceof Switch).map(ap => `<option value="${escapeHTML(ap.getSSID())}" ${device.getWireless().ssid === ap.getSSID() ? 'selected' : ''}>${escapeHTML(ap.getSSID())}</option>`).join('')}</select><p>WLAN ersetzt die LAN-Verbindung und belegt einen Anschluss am Switch.</p></div>
          <div class="config-section">
            <div class="config-section-title">Hardware</div>
            <div class="form-group">
              <label>${i18n.t('config.macAddress')}</label>
              <input type="text" class="form-control" value="${iface.getMAC()}" readonly style="opacity: 0.7" />
            </div>
            <div class="form-group">
              <label>Verbindung</label>
              <input type="text" value="${isConnected ? 'Verbunden' : 'Nicht verbunden'}" readonly style="opacity: 0.7" />
            </div>

          </div>
        `;
        this.scope.listen(document.getElementById('cfg-desktop'), 'click', () => this.context.openDesktop(device));
        // Only add event listeners in design mode
        if (!readOnly) {
            this.scope.listen(document.getElementById('cfg-name'), 'change', (e) => {
                device.setName((e.target as HTMLInputElement).value);
                if (title)
                    title.textContent = device.getName();
            });
            this.scope.listen(document.getElementById('cfg-color'), 'input', (e) => {
                const color = (e.target as HTMLInputElement).value;
                (device as Host).setColor(color);
                // Update display span
                const span = (e.target as HTMLInputElement).nextElementSibling;
                if (span)
                    span.textContent = color;
            });
            this.scope.listen(document.getElementById('cfg-ip'), 'change', (e) => {
                if (!iface.isDHCPEnabled()) {
                    iface.setIP((e.target as HTMLInputElement).value);
                }
            });
            this.scope.listen(document.getElementById('cfg-subnet'), 'change', (e) => {
                if (!iface.isDHCPEnabled()) {
                    iface.setSubnetMask((e.target as HTMLInputElement).value);
                }
            });
            this.scope.listen(document.getElementById('cfg-gateway'), 'change', (e) => {
                if (!iface.isDHCPEnabled()) {
                    iface.setGateway((e.target as HTMLInputElement).value);
                }
            });
            this.scope.listen(document.getElementById('cfg-dns'), 'change', (e) => {
                if (!iface.isDHCPEnabled()) {
                    iface.setDNS((e.target as HTMLInputElement).value);
                }
            });
            const updateWireless = () => device.setWireless((document.getElementById('cfg-wireless') as HTMLInputElement).checked, (document.getElementById('cfg-ssid') as HTMLSelectElement).value);
            this.scope.listen(document.getElementById('cfg-wireless'), 'change', updateWireless);
            this.scope.listen(document.getElementById('cfg-ssid'), 'change', updateWireless);
            this.scope.listen(document.getElementById('cfg-dhcp'), 'change', (e) => {
                iface.setDHCP((e.target as HTMLInputElement).checked);
                this.context.refresh(device); // Refresh to update field states
            });
        }
    }
}
