import { Lifetime } from '../../core/Lifetime';
import { Host, Switch, Vermittlungsrechner, Modem, type Knoten, type Kabel } from '../../hardware';
import { i18n } from '../../i18n';
import type { InspectorContext } from './Inspector';
import { HostInspector } from './HostInspector';
import { SwitchInspector } from './SwitchInspector';
import { VermittlungsrechnerInspector } from './VermittlungsrechnerInspector';
import { ModemInspector } from './ModemInspector';
import type { Inspector } from './Inspector';
import { escapeHTML } from '../html';
export class DeviceConfiguration {
    private inspector: Inspector | null = null;
    private scope = new Lifetime();
    constructor(private context: InspectorContext) { }
    showConfigPanel(device: Knoten): void {
        this.inspector?.dispose();
        this.inspector = null;
        this.scope.dispose();
        this.scope = new Lifetime();
        if (!device)
            return;
        const panel = document.getElementById('config-panel');
        const title = document.getElementById('config-title');
        const content = document.getElementById('config-content');
        if (!panel || !title || !content)
            return;
        const configTabBtn = document.querySelector('.tab-btn[data-tab="config"]') as HTMLElement;
        configTabBtn?.click();
        if (window.innerWidth < 768) {
            document.getElementById('sidebar')?.classList.add('open');
            document.getElementById('btn-panel')?.setAttribute('aria-expanded', 'true');
        }
        panel.classList.remove('hidden');
        title.textContent = device.getName();
        if (device instanceof Host)
            this.inspector = new HostInspector(this.context);
        else if (device instanceof Switch)
            this.inspector = new SwitchInspector(this.context);
        else if (device instanceof Vermittlungsrechner)
            this.inspector = new VermittlungsrechnerInspector(this.context);
        else if (device instanceof Modem)
            this.inspector = new ModemInspector(this.context);
        this.inspector?.render(device, content);
    }
    showCable(cable: Kabel): void {
        this.inspector?.dispose();
        this.inspector = null;
        this.scope.dispose();
        this.scope = new Lifetime();
        if (this.context.isSimulation())
            return;
        const panel = document.getElementById('config-panel');
        const title = document.getElementById('config-title');
        const content = document.getElementById('config-content');
        if (!panel || !title || !content)
            return;
        panel.classList.remove('hidden');
        title.textContent = 'Kabelverbindung';
        const ep1 = cable.getEndpoint1();
        const ep2 = cable.getEndpoint2();
        content.innerHTML = `

        <div class="config-section">
          <div class="config-section-title">Verbindung</div>
            <div class="form-group">
              <label>Gerät 1</label>
              <input type="text" value="${escapeHTML(ep1?.node.getName() || '?')}" readonly style="opacity: 0.7" />
            </div>
            <div class="form-group">
              <label>Gerät 2</label>
              <input type="text" value="${escapeHTML(ep2?.node.getName() || '?')}" readonly style="opacity: 0.7" />
            </div>
        </div>
        <div class="config-section" style="margin-top: 16px;">
          <button class="btn btn-danger" id="btn-delete-cable" style="width: 100%;">
            Kabel löschen
          </button>
        </div>`;
        this.scope.listen(document.getElementById('btn-delete-cable'), 'click', () => this.context.deleteCable(cable));
    }
    clear(): void {
        this.inspector?.dispose();
        this.inspector = null;
        this.scope.dispose();
        const title = document.getElementById('config-title');
        if (title)
            title.textContent = i18n.t('config.name');
        const content = document.getElementById('config-content');
        if (content)
            content.textContent = 'Wähle ein Gerät oder Kabel aus.';
    }
    dispose(): void { this.clear(); }
}
