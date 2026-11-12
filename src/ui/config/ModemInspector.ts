import { Inspector } from './Inspector';
import { escapeHTML } from '../../ui/html';
import { i18n } from '../../i18n';
import { Events } from '../../core/EventBus';
import { bindModemControls } from '../../ui/ModemControls';
import { Modem } from '../../hardware';
export class ModemInspector extends Inspector {
    render(device: Modem, content: HTMLElement): void {
        const status = device.getStatus();
        const isConnected = status === 'connected';
        const statusColor = isConnected ? '#22c55e' : (status === 'connecting' ? '#eab308' : '#ef4444');
        const statusText = status === 'connected' ? 'Verbunden' : (status === 'connecting' ? 'Verbindet...' : 'Getrennt');
        const ro = this.context.isSimulation() ? 'readonly' : '';
        // --- Preserve UI State ---
        // We must read the existing DOM inputs *before* we overwrite content.innerHTML,
        // because overwriting it destroys the input elements.
        let activeMode: 'manual' | 'auto' = 'manual';
        let cachedSessionId = '';
        let cachedServerUrl = './signaling.php';
        let cachedJoinId = '';
        const currentPanelManual = document.getElementById('modem-panel-manual');
        const currentSessionId = document.getElementById('modem-session-id');
        const currentServerUrlInput = document.getElementById('modem-server-url') as HTMLInputElement;
        const currentJoinIdInput = document.getElementById('modem-join-id') as HTMLInputElement;
        if (currentPanelManual) {
            activeMode = currentPanelManual.style.display !== 'none' ? 'manual' : 'auto';
        }
        if (currentSessionId && currentSessionId.textContent) {
            cachedSessionId = currentSessionId.textContent;
        }
        if (currentServerUrlInput) {
            cachedServerUrl = currentServerUrlInput.value;
        }
        if (currentJoinIdInput) {
            cachedJoinId = currentJoinIdInput.value;
        }
        // --- Render content once ---
        content.innerHTML = `
        <div class="config-section">
          <div class="config-section-title">Eigenschaften</div>
          <div class="form-group">
            <label>${i18n.t('config.name')}</label>
            <input type="text" id="cfg-name" class="form-control" value="${escapeHTML(device.getName())}" ${ro} />
          </div>
          <div class="form-group">
            <label>Status</label>
            <div style="display: flex; align-items: center; gap: 8px;">
               <div style="width: 10px; height: 10px; border-radius: 50%; background: ${statusColor};"></div>
               <span>${statusText}</span>
            </div>
            ${device.getError() ? `<div style="color: #ef4444; font-size: 0.75rem; margin-top: 4px;">${escapeHTML(device.getError())}</div>` : ''}
          </div>
        </div>

        <div class="config-section">
            <div class="config-section-title">Verbindung (WebRTC)</div>

            <!-- Mode Selector -->
            <div style="display: flex; background: var(--bg-tertiary); padding: 4px; border-radius: 6px; margin-bottom: 12px;">
                <button class="btn btn-sm btn-secondary" id="modem-mode-auto" style="flex: 1; border: none; background: ${activeMode === 'auto' ? 'var(--bg-primary)' : 'transparent'}; color: ${activeMode === 'auto' ? 'var(--primary)' : 'var(--text-primary)'};">Server</button>
                <button class="btn btn-sm btn-secondary" id="modem-mode-manual" style="flex: 1; border: none; background: ${activeMode === 'manual' ? 'var(--bg-primary)' : 'transparent'}; color: ${activeMode === 'manual' ? 'var(--primary)' : 'var(--text-primary)'};">Manuell</button>
            </div>

            <!-- Auto Panel (Default) -->
            <div id="modem-panel-auto" style="display: ${activeMode === 'auto' ? 'block' : 'none'};">
                <div class="form-group">
                    <label>Signaling Server</label>
                    <input type="text" id="modem-server-url" class="form-control" value="${escapeHTML(cachedServerUrl)}" />
                </div>

                <div style="margin-bottom: 16px;">
                     <button class="btn btn-primary" id="modem-auto-host" style="width: 100%;" ${isConnected ? 'disabled' : ''}>Als Host warten</button>
                     <div id="modem-auto-host-status" style="display: ${cachedSessionId ? 'block' : 'none'}; margin-top: 8px; padding: 10px; background: var(--bg-tertiary); border-radius: 4px; text-align: center;">
                        <div style="font-size: 0.8rem;">Session ID:</div>
                        <div id="modem-session-id" style="font-size: 1.2rem; font-weight: bold; letter-spacing: 2px; user-select: all; cursor: pointer;">${escapeHTML(cachedSessionId)}</div>
                        <div style="font-size: 0.7rem; color: var(--text-secondary); margin-top: 4px;">Warte auf Partner...</div>
                    </div>
                </div>

                <div style="border-top: 1px dashed var(--border-color); margin-top: 12px; padding-top: 12px;">
                    <div style="display: flex; gap: 4px;">
                        <input type="text" id="modem-join-id" class="form-control" placeholder="Session ID" value="${escapeHTML(cachedJoinId)}" style="flex: 1;" />
                        <button class="btn btn-sm btn-secondary" id="modem-auto-join" ${isConnected ? 'disabled' : ''}>Verbinden</button>
                    </div>
                </div>
            </div>

            <!-- Manual Panel -->
            <div id="modem-panel-manual" style="display: ${activeMode === 'manual' ? 'block' : 'none'};">
                <div style="margin-bottom: 16px;">
                    <div style="font-weight: bold; margin-bottom: 4px; font-size: 0.8rem;">Hosten (Schritt 1)</div>
                    <button class="btn btn-primary btn-sm" id="modem-create-offer" style="width: 100%;" ${isConnected ? 'disabled' : ''}>Offer erstellen</button>
                    <textarea id="modem-offer-out" class="form-control" style="display: none; height: 60px; margin-top: 4px; font-size: 0.7rem;" readonly></textarea>
                    <div id="modem-offer-copy-feedback" style="display: none; color: #22c55e; font-size: 0.7rem; text-align: right;">In die Zwischenablage kopiert!</div>
                </div>

                <div style="margin-bottom: 16px; border-top: 1px dashed var(--border-color); padding-top: 12px;">
                    <div style="font-weight: bold; margin-bottom: 4px; font-size: 0.8rem;">Verbinden (Schritt 2)</div>
                    <textarea id="modem-offer-in" class="form-control" placeholder="Offer vom Host hier einfügen..." style="height: 60px; font-size: 0.7rem;"></textarea>
                    <button class="btn btn-secondary btn-sm" id="modem-accept-offer" style="width: 100%; margin-top: 4px;" ${isConnected ? 'disabled' : ''}>Antwort generieren</button>
                    <textarea id="modem-answer-out" class="form-control" style="display: none; height: 60px; margin-top: 4px; font-size: 0.7rem;" readonly></textarea>
                     <div id="modem-answer-copy-feedback" style="display: none; color: #22c55e; font-size: 0.7rem; text-align: right;">In die Zwischenablage kopiert!</div>
                </div>

                 <div id="modem-answer-section" style="display: none; border-top: 1px dashed var(--border-color); padding-top: 12px;">
                    <div style="font-weight: bold; margin-bottom: 4px; font-size: 0.8rem;">Finalisieren (Schritt 3 - nur Host)</div>
                    <textarea id="modem-answer-in" class="form-control" placeholder="Antwort vom Client hier einfügen..." style="display: none; height: 60px; font-size: 0.7rem;"></textarea>
                    <button class="btn btn-success btn-sm" id="modem-finalize" style="display: none; width: 100%; margin-top: 4px;" ${isConnected ? 'disabled' : ''}>Verbindung herstellen</button>
                </div>
            </div>

            <!-- Debug Logs -->
            <div style="margin-top: 12px; border-top: 1px solid var(--border-color); padding-top: 8px;">
                <label style="font-size: 0.75rem;">Debug Log</label>
                <div id="modem-debug-log" style="height: 100px; overflow-y: auto; background: #000; color: #0f0; font-family: monospace; font-size: 0.7rem; padding: 4px; border-radius: 4px; white-space: pre-wrap;">${escapeHTML(device.getLogs().join('\n'))}</div>
            </div>

            ${isConnected ? `
            <div style="margin-top: 20px;">
                <button class="btn btn-danger" id="modem-disconnect" style="width: 100%;">Trennen</button>
            </div>
            ` : ''}
        </div>
      `;
        const ice = document.createElement('div');
        ice.className = 'config-section';
        ice.innerHTML = '<label for="modem-ice">STUN/TURN-Server (JSON)</label><textarea id="modem-ice" class="form-control" rows="3"></textarea><p>Für Verbindungen über verschiedene Netze. Leer lassen für direkte LAN-Verbindungen.</p><p id="modem-ice-status" role="status"></p>';
        content.append(ice);
        const iceInput = ice.querySelector('#modem-ice') as HTMLTextAreaElement;
        iceInput.value = JSON.stringify(device.getICEServers(), null, 2);
        this.scope.listen(iceInput, 'change', () => {
            try {
                device.setICEServers(JSON.parse(iceInput.value || '[]'));
                this.context.dependencies.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'modem' });
            }
            catch (error) {
                ice.querySelector('#modem-ice-status')!.textContent = String(error);
            }
        });
        this.scope.listen(document.getElementById('cfg-name'), 'change', e => device.setName((e.target as HTMLInputElement).value));
        bindModemControls(device, content, this.scope);
    }
}
