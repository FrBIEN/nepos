import { Inspector } from './Inspector';
import { escapeHTML } from '../../ui/html';
import { i18n } from '../../i18n';
import { Switch } from '../../hardware';
export class SwitchInspector extends Inspector {
    render(device: Switch, content: HTMLElement): void {
        const title = document.getElementById('config-title');
        const ro = this.context.isSimulation() ? 'readonly' : '';
        content.innerHTML = `
        <div class="config-section">
          <div class="config-section-title">Eigenschaften</div>
          <div class="form-group">
            <label>${i18n.t('config.name')}</label>
            <input type="text" id="cfg-name" class="form-control" value="${escapeHTML(device.getName())}" ${ro} />
          </div>
          <div class="form-group">
            <label for="cfg-ap-ssid">WLAN-Name / SSID</label><input id="cfg-ap-ssid" class="form-control" maxlength="32" value="${escapeHTML(device.getSSID())}" ${ro}/></div><div class="form-group"><label>Ports</label>
            <input type="text" class="form-control" value="${device.getPortCount()}" readonly style="opacity: 0.7" />
          </div>
        </div>
        <div class="config-section">
          <div class="config-section-title">MAC-Tabelle</div>
          <div style="color: var(--text-secondary); font-size: 0.875rem;">
            ${device.getMACTable().length === 0
            ? '<p>Keine Einträge</p>'
            : device.getMACTable().map(e => `<div>${e.mac} → Port ${e.port}</div>`).join('')}
          </div>
        </div>
      `;
        if (!this.context.isSimulation()) {
            this.scope.listen(document.getElementById('cfg-ap-ssid'), 'change', e => {
                try {
                    device.setSSID((e.target as HTMLInputElement).value);
                }
                catch (error) {
                    void this.showNotice(String(error));
                }
            });
            this.scope.listen(document.getElementById('cfg-name'), 'change', (e) => {
                device.setName((e.target as HTMLInputElement).value);
                if (title)
                    title.textContent = device.getName();
            });
        }
    }
}
