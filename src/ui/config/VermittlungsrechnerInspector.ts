import { Inspector } from './Inspector';
import { createDismissButton } from '../../ui/DismissButton';
import { escapeHTML } from '../../ui/html';
import { i18n } from '../../i18n';
import { Events } from '../../core/EventBus';
import { Vermittlungsrechner } from '../../hardware';

export class VermittlungsrechnerInspector extends Inspector {
    render(device: Vermittlungsrechner, content: HTMLElement): void {
        const title = document.getElementById('config-title');
        const ifaces = device.getInterfaces();
        const ro = this.context.isSimulation() ? 'readonly' : '';
        let ifaceHtml = '';
        ifaces.forEach((iface, i) => {
            const canRemove = device.canRemoveInterface() && !this.context.isSimulation();
            ifaceHtml += `
          <div style="margin-bottom: 12px; padding: 12px; background: var(--bg-tertiary); border-radius: 8px; position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-weight: 600;">Interface ${i + 1}</span>
              ${canRemove ? `<button class="btn btn-sm btn-danger cfg-remove-iface" data-idx="${i}" style="padding: 2px 8px;">×</button>` : ''}
            </div>
            <div class="form-group">
              <label>IP</label>
              <input type="text" class="form-control cfg-router-ip" data-idx="${i}" value="${iface.getIP()}" ${ro} />
            </div>
            <div class="form-group">
              <label>Subnetz</label>
              <input type="text" class="form-control cfg-router-subnet" data-idx="${i}" value="${iface.getSubnetMask()}" ${ro} />
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary);">MAC: ${iface.getMAC()}</div>
          </div>
        `;
        });
        const canAdd = device.canAddInterface() && !this.context.isSimulation();
        content.innerHTML = `
        <div class="config-section">
          <div class="config-section-title">Eigenschaften</div>
          <div class="form-group">
            <label>${i18n.t('config.name')}</label>
            <input type="text" id="cfg-name" class="form-control" value="${escapeHTML(device.getName())}" ${ro} />
          </div>
        </div>
        <div class="config-section">
          <div class="config-section-title" style="display: flex; justify-content: space-between; align-items: center;">
            <span>Schnittstellen (${ifaces.length} / ${Vermittlungsrechner.MAX_INTERFACES})</span>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-sm btn-primary" id="cfg-add-iface" ${canAdd ? '' : 'disabled'}>+</button>
            </div>
          </div>
          ${ifaceHtml}
        </div>
        <div class="config-section">
          <div class="config-section-title">Routing-Tabelle</div>
          <div style="font-size: 0.75rem; max-height: 150px; overflow-y: auto;">
            ${device.getRoutingTable().map((route, i) => `
              <div style="display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--border-color);">
                <span style="flex: 1;">${route.network}/${route.subnetMask.split('.').reduce((acc, octet) => acc + parseInt(octet).toString(2).split('1').length - 1, 0)}</span>
                <span style="color: var(--text-secondary);">→ ${route.gateway === '0.0.0.0' ? 'direkt' : route.gateway}</span>
                <span style="color: var(--text-secondary);">IF${route.interfaceIndex + 1}</span>
                ${route.isStatic ? `<button class="btn btn-sm btn-danger" data-route-idx="${i}" style="padding: 2px 6px;">×</button>` : ''}
              </div>
            `).join('')}
          </div>
          <div style="margin-top: 8px;">
            <button class="btn btn-sm btn-secondary" id="cfg-add-route">+ Statische Route</button>
          </div>
        </div>
        <div class="config-section">
          <div class="config-section-title" style="display: flex; justify-content: space-between; align-items: center;">
            <span>Firewall</span>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="checkbox" id="cfg-firewall" ${device.isFirewallEnabled() ? 'checked' : ''} />
              <label for="cfg-firewall" style="margin: 0; font-weight: normal; font-size: 0.75rem;">Aktiv</label>
            </div>
          </div>
          <div style="font-size: 0.7rem; max-height: 150px; overflow-y: auto; margin-bottom: 8px;">
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="border-bottom: 1px solid var(--border-color); text-align: left;">
                  <th style="padding: 2px 4px;">Aktion</th>
                  <th style="padding: 2px 4px;">Proto</th>
                  <th style="padding: 2px 4px;">Quelle</th>
                  <th style="padding: 2px 4px;">Ziel</th>
                  <th style="padding: 2px 4px; width: 20px;"></th>
                </tr>
              </thead>
              <tbody>
                ${device.getFirewallRules().map(rule => `
                  <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="padding: 3px 4px; color: ${rule.action === 'allow' ? '#22c55e' : '#ef4444'}; font-weight: 600;">${rule.action === 'allow' ? '✓' : '✗'}</td>
                    <td style="padding: 3px 4px;">${rule.protocol.toUpperCase()}</td>
                    <td style="padding: 3px 4px;" title="${escapeHTML(rule.sourceIP)}${escapeHTML(rule.sourcePort ? ':' + rule.sourcePort : '')}">${escapeHTML(rule.sourceIP === 'any' ? '*' : rule.sourceIP.substring(0, 12))}${escapeHTML(rule.sourcePort ? ':' + rule.sourcePort : '')}</td>
                    <td style="padding: 3px 4px;" title="${escapeHTML(rule.destIP)}${escapeHTML(rule.destPort ? ':' + rule.destPort : '')}">${escapeHTML(rule.destIP === 'any' ? '*' : rule.destIP.substring(0, 12))}${escapeHTML(rule.destPort ? ':' + rule.destPort : '')}</td>
                    <td style="padding: 3px 4px;"><button class="cfg-del-rule" data-rule-id="${escapeHTML(rule.id)}" style="border: none; background: none; color: #ef4444; cursor: pointer; font-size: 12px;">×</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <button class="btn btn-sm btn-secondary" id="cfg-add-rule" style="width: 100%;">+ Regel hinzufügen</button>
        </div>
      `;
        const advanced = document.createElement('div');
        advanced.className = 'config-section';
        advanced.innerHTML = `<div class="config-section-title">Gateway und automatisches Routing</div>
        <label class="checkbox-group"><input type="checkbox" id="cfg-forwarding" ${device.isIPForwardingEnabled() ? 'checked' : ''}/>IP-Weiterleitung</label>
        <label class="checkbox-group"><input type="checkbox" id="cfg-rip" ${device.isRIPEnabled() ? 'checked' : ''}/>RIP-Routen automatisch lernen</label>
        <label class="checkbox-group"><input type="checkbox" id="cfg-nat" ${device.isNATEnabled() ? 'checked' : ''}/>NAT aktivieren</label>
        <label>WAN-Schnittstelle<select id="cfg-wan" class="form-control">${device.getInterfaces().map((iface, i) => `<option value="${i}" ${i === device.getWANInterface() ? 'selected' : ''}>IF ${i + 1} · ${iface.getIP()}</option>`).join('')}</select></label>
        <p style="margin-top:12px">Portweiterleitung</p><div id="cfg-forwards"></div>
        <select id="cfg-pf-proto" class="form-control"><option value="tcp">TCP</option><option value="udp">UDP</option></select>
        <label>Externer Port<input id="cfg-pf-ext" type="number" min="1" max="65535" class="form-control" value="8080"/></label>
        <label>Interne IP<input id="cfg-pf-ip" class="form-control" /></label>
        <label>Interner Port<input id="cfg-pf-int" type="number" min="1" max="65535" class="form-control" value="80"/></label>
        <button id="cfg-pf-add" class="btn btn-secondary">Weiterleitung hinzufügen</button><p id="cfg-pf-status" role="status"></p>
        <button id="cfg-nat-table" class="btn btn-secondary">NAT-Tabelle anzeigen</button><pre id="cfg-nat-entries" style="white-space:pre-wrap;font-size:12px"></pre>`;
        content.append(advanced);
        const changed = () => this.context.dependencies.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'router' });
        this.scope.listen(advanced.querySelector('#cfg-forwarding')!, 'change', e => { device.setIPForwardingEnabled((e.target as HTMLInputElement).checked); changed(); });
        this.scope.listen(advanced.querySelector('#cfg-rip')!, 'change', e => { device.setRIPEnabled((e.target as HTMLInputElement).checked); changed(); });
        this.scope.listen(advanced.querySelector('#cfg-nat')!, 'change', e => { device.setNATEnabled((e.target as HTMLInputElement).checked); changed(); });
        this.scope.listen(advanced.querySelector('#cfg-wan')!, 'change', e => { device.setWANInterface(Number((e.target as HTMLSelectElement).value)); changed(); });
        const renderForwards = () => {
            const list = advanced.querySelector('#cfg-forwards')!;
            list.replaceChildren();
            device.getPortForwards().forEach((rule, i) => { const button = document.createElement('button'); button.className = 'btn btn-secondary'; button.textContent = `${rule.protocol.toUpperCase()} ${rule.externalPort} → ${rule.internalIP}:${rule.internalPort} ×`; button.onclick = () => { device.removePortForward(i); changed(); renderForwards(); }; list.append(button); });
        };
        renderForwards();
        this.scope.listen(advanced.querySelector('#cfg-pf-add')!, 'click', () => {
            const value = (id: string) => (advanced.querySelector(`#${id}`) as HTMLInputElement).value;
            try {
                device.addPortForward({ protocol: value('cfg-pf-proto') as 'tcp' | 'udp', externalPort: Number(value('cfg-pf-ext')), internalIP: value('cfg-pf-ip'), internalPort: Number(value('cfg-pf-int')) });
                changed();
                renderForwards();
            }
            catch (error) {
                advanced.querySelector('#cfg-pf-status')!.textContent = String(error);
            }
        });
        this.scope.listen(advanced.querySelector('#cfg-nat-table')!, 'click', () => { advanced.querySelector('#cfg-nat-entries')!.textContent = this.context.dependencies.network.getNATTable(device).map(e => `${e.protocol} ${e.insideIP}:${e.insidePort} → WAN:${e.outsidePort} ↔ ${e.remoteIP}:${e.remotePort}`).join('\n') || 'Keine aktiven Übersetzungen'; });
        this.scope.listen(document.getElementById('cfg-name'), 'change', (e) => {
            device.setName((e.target as HTMLInputElement).value);
            if (title)
                title.textContent = device.getName();
        });
        document.querySelectorAll('.cfg-router-ip').forEach(el => {
            this.scope.listen(el, 'change', (e) => {
                const idx = parseInt((e.target as HTMLInputElement).dataset.idx || '0');
                device.getInterface(idx)?.setIP((e.target as HTMLInputElement).value);
            });
        });
        document.querySelectorAll('.cfg-router-subnet').forEach(el => {
            this.scope.listen(el, 'change', (e) => {
                const idx = parseInt((e.target as HTMLInputElement).dataset.idx || '0');
                device.getInterface(idx)?.setSubnetMask((e.target as HTMLInputElement).value);
            });
        });
        // Add interface button
        this.scope.listen(document.getElementById('cfg-add-iface'), 'click', () => {
            if (device.canAddInterface()) {
                device.addInterface();
                this.context.refresh(device); // Refresh panel
            }
        });
        // Remove interface buttons
        document.querySelectorAll('.cfg-remove-iface').forEach(btn => {
            this.scope.listen(btn, 'click', (e) => {
                const idx = parseInt((e.target as HTMLElement).dataset.idx || '0');
                if (device.canRemoveInterface() && device.removeInterface(idx)) {
                    this.context.refresh(device); // Refresh panel
                }
            });
        });
        // Remove static route buttons
        document.querySelectorAll('[data-route-idx]').forEach(btn => {
            this.scope.listen(btn, 'click', (e) => {
                const idx = parseInt((e.target as HTMLElement).dataset.routeIdx || '0');
                device.removeRoute(idx);
                this.context.refresh(device); // Refresh panel
            });
        });
        // Add static route button - show modal dialog
        this.scope.listen(document.getElementById('cfg-add-route'), 'click', () => {
            this.showStaticRouteModal(device);
        });
        // Firewall toggle
        this.scope.listen(document.getElementById('cfg-firewall'), 'change', (e) => {
            device.setFirewallEnabled((e.target as HTMLInputElement).checked);
        });
        // Add firewall rule - show modal dialog
        this.scope.listen(document.getElementById('cfg-add-rule'), 'click', () => {
            this.showFirewallRuleModal(device);
        });
        // Delete firewall rules
        document.querySelectorAll('.cfg-del-rule').forEach(btn => {
            this.scope.listen(btn, 'click', (e) => {
                const ruleId = (e.target as HTMLElement).dataset.ruleId;
                if (ruleId && device.removeFirewallRule(ruleId)) {
                    this.context.refresh(device);
                }
            });
        });
    }
    private showFirewallRuleModal(device: Vermittlungsrechner): void {
        // Remove existing modal
        document.getElementById('firewall-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'firewall-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `

        <div class="modal-content" style="width: 400px;">
            <div class="modal-header">
                <h3>Firewall - Regel hinzufügen</h3>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Aktion</label>
                    <select id="fw-action" class="form-control">
                        <option value="deny">Blockieren (deny)</option>
                        <option value="allow">Erlauben (allow)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Protokoll</label>
                    <select id="fw-protocol" class="form-control">
                        <option value="any">Alle (any)</option>
                        <option value="tcp">TCP</option>
                        <option value="udp">UDP</option>
                        <option value="icmp">ICMP</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Richtung</label>
                    <select id="fw-direction" class="form-control">
                        <option value="both">Beide</option>
                        <option value="inbound">Eingehend</option>
                        <option value="outbound">Ausgehend</option>
                    </select>
                </div>
                <div style="display: flex; gap: 12px;">
                    <div class="form-group" style="flex: 1;">
                        <label>Quell-IP</label>
                        <input type="text" id="fw-src-ip" class="form-control" value="any" placeholder="any oder IP/CIDR" />
                    </div>
                    <div class="form-group" style="width: 80px;">
                        <label>Port</label>
                        <input type="text" id="fw-src-port" class="form-control" placeholder="z.B. 80" />
                    </div>
                </div>
                <div style="display: flex; gap: 12px;">
                    <div class="form-group" style="flex: 1;">
                        <label>Ziel-IP</label>
                        <input type="text" id="fw-dest-ip" class="form-control" value="any" placeholder="any oder IP/CIDR" />
                    </div>
                    <div class="form-group" style="width: 80px;">
                        <label>Port</label>
                        <input type="text" id="fw-dest-port" class="form-control" placeholder="z.B. 443" />
                    </div>
                </div>
                <div class="form-group">
                    <label>Beschreibung (optional)</label>
                    <input type="text" id="fw-desc" class="form-control" placeholder="z.B. HTTP blockieren" />
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" id="fw-cancel">Abbrechen</button>
                <button class="btn btn-primary" id="fw-save">Speichern</button>
            </div>
        </div>`;
        document.body.appendChild(modal);
        this.scope.add(() => modal.remove());
        // Event listeners
        const closeModal = () => modal.remove();
        modal.querySelector('.modal-content')?.append(createDismissButton(closeModal, 'Firewall-Regel schließen'));
        this.scope.listen(modal.querySelector('#fw-cancel'), 'click', closeModal);
        this.scope.listen(modal, 'click', (e) => {
            if (e.target === modal)
                closeModal();
        });
        this.scope.listen(modal.querySelector('#fw-save'), 'click', () => {
            const action = (document.getElementById('fw-action') as HTMLSelectElement).value as 'allow' | 'deny';
            const protocol = (document.getElementById('fw-protocol') as HTMLSelectElement).value as 'any' | 'icmp' | 'tcp' | 'udp';
            const direction = (document.getElementById('fw-direction') as HTMLSelectElement).value as 'inbound' | 'outbound' | 'both';
            const sourceIP = (document.getElementById('fw-src-ip') as HTMLInputElement).value || 'any';
            const sourcePort = (document.getElementById('fw-src-port') as HTMLInputElement).value || undefined;
            const destIP = (document.getElementById('fw-dest-ip') as HTMLInputElement).value || 'any';
            const destPort = (document.getElementById('fw-dest-port') as HTMLInputElement).value || undefined;
            const description = (document.getElementById('fw-desc') as HTMLInputElement).value || undefined;
            try {
                device.addFirewallRule({
                    enabled: true,
                    action,
                    direction,
                    protocol,
                    sourceIP,
                    destIP,
                    sourcePort,
                    destPort,
                    description,
                });
            }
            catch (error) {
                let feedback = modal.querySelector<HTMLElement>('.firewall-error');
                if (!feedback) {
                    feedback = document.createElement('p');
                    feedback.className = 'firewall-error';
                    feedback.setAttribute('role', 'alert');
                    modal.querySelector('.modal-body')?.append(feedback);
                }
                feedback.textContent = error instanceof Error ? error.message : String(error);
                return;
            }
            closeModal();
            this.context.refresh(device);
        });
    }
    private showStaticRouteModal(device: Vermittlungsrechner): void {
        // Remove existing modal
        document.getElementById('route-modal')?.remove();
        const interfaces = device.getInterfaces();
        const interfaceOptions = interfaces.map((iface, i) => `<option value="${i}">IF${i + 1}: ${iface.getIP() || 'nicht konfiguriert'}</option>`).join('');
        const modal = document.createElement('div');
        modal.id = 'route-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
      <div class="modal-content" style="width: 400px;">
        <div class="modal-header">
          <h3>Statische Route hinzufügen</h3>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Ziel-Netzwerk</label>
            <input type="text" id="route-network" class="form-control" placeholder="z.B. 10.0.0.0" value="10.0.0.0" />
          </div>
          <div class="form-group">
            <label>Subnetzmaske</label>
            <input type="text" id="route-mask" class="form-control" placeholder="z.B. 255.255.255.0" value="255.255.255.0" />
          </div>
          <div class="form-group">
            <label>Gateway (Next Hop)</label>
            <input type="text" id="route-gateway" class="form-control" placeholder="z.B. 192.168.1.1" />
          </div>
          <div class="form-group">
            <label>Ausgehendes Interface</label>
            <select id="route-interface" class="form-control">
              ${interfaceOptions}
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="route-cancel">Abbrechen</button>
          <button class="btn btn-primary" id="route-save">Speichern</button>
        </div>
      </div>
    `;
        document.body.appendChild(modal);
        this.scope.add(() => modal.remove());
        // Event listeners
        const closeModal = () => modal.remove();
        modal.querySelector('.modal-content')?.append(createDismissButton(closeModal, 'Route schließen'));
        this.scope.listen(modal.querySelector('#route-cancel'), 'click', closeModal);
        this.scope.listen(modal, 'click', (e) => {
            if (e.target === modal)
                closeModal();
        });
        this.scope.listen(modal.querySelector('#route-save'), 'click', () => {
            const network = (document.getElementById('route-network') as HTMLInputElement).value.trim();
            const mask = (document.getElementById('route-mask') as HTMLInputElement).value.trim();
            const gateway = (document.getElementById('route-gateway') as HTMLInputElement).value.trim();
            const ifaceIdx = parseInt((document.getElementById('route-interface') as HTMLSelectElement).value);
            if (network && mask && gateway) {
                device.addStaticRoute(network, mask, gateway, ifaceIdx);
                closeModal();
                this.context.refresh(device);
            }
        });
    }
}
