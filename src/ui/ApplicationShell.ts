import { escapeHTML } from './html';
import { i18n } from '../i18n';
import { glyph } from './Glyphs';
import { Icons } from './IconManager';
export function renderApplicationShell(root: HTMLElement): void {
    root.innerHTML = `
      <header class="toolbar">
        <div class="toolbar-left">
          <button id="btn-panel" class="btn btn-secondary" aria-label="Geräte und Einstellungen" aria-expanded="false">${glyph('menu')}</button><span class="logo">Nepos</span>
          <button class="btn btn-secondary" id="btn-new" data-tooltip="${i18n.t('actions.new')}">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="12" y1="18" x2="12" y2="12"></line>
              <line x1="9" y1="15" x2="15" y2="15"></line>
            </svg>
          </button>
          <button class="btn btn-secondary" id="btn-load" data-tooltip="${i18n.t('actions.load')}">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
          </button>
          <button class="btn btn-secondary" id="btn-save" data-tooltip="${i18n.t('actions.save')}">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
              <polyline points="17 21 17 13 7 13 7 21"></polyline>
              <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
          </button>
        </div>

        <div class="toolbar-center">
          <div class="history-controls" aria-label="Entwurfsverlauf">
            <button class="btn btn-secondary" id="btn-undo" aria-label="Rückgängig" title="Rückgängig (Strg/⌘ Z)" disabled>${glyph('undo')}</button>
            <button class="btn btn-secondary" id="btn-redo" aria-label="Wiederholen" title="Wiederholen (Strg/⌘ Umschalt Z)" disabled>${glyph('redo')}</button>
          </div>
          <div class="mode-toggle">
            <button id="mode-design" class="active">${i18n.t('app.designMode')}</button>
            <button id="mode-simulation">${i18n.t('app.simulationMode')}</button>
          </div>
          <div class="speed-control" id="speed-control" style="display: none; align-items: center; margin-left: 15px; background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 4px;">
            <button class="btn btn-sm btn-secondary" id="btn-play-pause" title="Pause" style="margin-right: 8px; width: 28px; height: 28px; padding: 0; display: flex; align-items: center; justify-content: center; border: none; background: transparent;">
               <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                 <rect x="6" y="4" width="4" height="16"></rect>
                 <rect x="14" y="4" width="4" height="16"></rect>
               </svg>
            </button>
            <span style="font-size: 0.8rem; margin-right: 8px; color: var(--text-secondary);">Speed:</span>
            <input type="range" id="simulation-speed" min="1" max="300" value="100" style="width: 80px; cursor: pointer;">
            <span id="speed-value" style="font-size: 0.75rem; margin-left: 5px; min-width: 35px; color: var(--text-secondary);">100%</span>
          </div>
        </div>

        <div class="toolbar-right">
          <button class="btn btn-secondary" id="btn-add-text" data-tooltip="Textfeld hinzufügen" style="display: none;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="4 7 4 4 20 4 20 7"></polyline>
              <line x1="9" y1="20" x2="15" y2="20"></line>
              <line x1="12" y1="4" x2="12" y2="20"></line>
            </svg>
          </button>

          <button class="btn btn-secondary" id="btn-packet-log" style="display: none;" data-tooltip="Datenaustausch">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span style="margin-left: 4px;">Datenaustausch</span>
          </button>
          <select class="lang-select" id="lang-select">
            <option value="de" ${i18n.getLocale() === 'de' ? 'selected' : ''}>Deutsch</option>
            <option value="en" ${i18n.getLocale() === 'en' ? 'selected' : ''}>English</option>
          </select>
        </div>
      </header>

      <main class="main-container">
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-tabs">
            <button class="tab-btn active" data-tab="devices" id="btn-tab-devices">Geräte</button>
            <button class="tab-btn" data-tab="config" id="btn-tab-config">Konfig</button>
            <button class="tab-btn" data-tab="help" id="btn-tab-help">Hilfe</button>
          </div>

          <!-- Tab: Devices -->
          <div class="sidebar-content active" id="tab-devices">
            <div class="sidebar-header">
              <h3>Geräte</h3>
            </div>
            <div class="device-palette">
              <div class="device-item" draggable="true" data-device="cable">
                 ${glyph('cable')}
                 <span>Kabel</span>
              </div>

              <div class="device-item" draggable="true" data-device="rechner">
                <img src="${escapeHTML(Icons.rechner)}" alt="${i18n.t('devices.computer')}" />
                <span>${i18n.t('devices.computer')}</span>
              </div>
              <div class="device-item" draggable="true" data-device="notebook">
                <img src="${escapeHTML(Icons.notebook)}" alt="${i18n.t('devices.notebook')}" />
                <span>${i18n.t('devices.notebook')}</span>
              </div>
              <div class="device-item" draggable="true" data-device="switch">
                <img src="${escapeHTML(Icons.switch)}" alt="${i18n.t('devices.switch')}" />
                <span>${i18n.t('devices.switch')}</span>
              </div>
              <div class="device-item" draggable="true" data-device="router">
                <img src="${escapeHTML(Icons.router)}" alt="${i18n.t('devices.router')}" />
                <span>${i18n.t('devices.router')}</span>
              </div>
              <div class="device-item" draggable="true" data-device="modem">
                <img src="${escapeHTML(Icons.modem)}" alt="Modem" />
                <span>Modem</span>
              </div>
            </div>

            <div class="sidebar-header" style="margin-top: 16px;">
              <h3>Dokumentation</h3>
            </div>
            <div class="device-palette">
              <div class="device-item" draggable="true" data-device="textbox">
                ${glyph('textbox')}
                <span>Textfeld</span>
              </div>
              <div class="device-item" draggable="true" data-device="label">
                ${glyph('label')}
                <span>Label</span>
              </div>
              <div class="device-item" draggable="true" data-device="rectangle">
                ${glyph('rectangle')}
                <span>Rechteck</span>
              </div>
            </div>

            <div class="sidebar-header" style="margin-top: 16px;">
              <h3>Projekt</h3>
            </div>
            <div style="padding: 12px; border-bottom: 1px solid var(--border-color);">
                <div class="form-group" style="margin-bottom: 8px;">
                  <label style="font-size: 0.75rem;">Projekttitel</label>
                  <input type="text" id="project-title" class="form-control" placeholder="Mein Netzwerk" style="font-size: 0.8rem;" />
                </div>
                <div class="form-group" style="margin-bottom: 8px;">
                  <label style="font-size: 0.75rem;">Beschreibung</label>
                  <textarea id="project-desc" class="form-control" placeholder="Projektbeschreibung..." rows="3" style="font-size: 0.8rem; resize: none; font-family: inherit; color: var(--text-primary);"></textarea>
                </div>
                <button class="btn btn-secondary" id="btn-recovery" type="button" style="width:100%;margin-bottom:8px">Gespeicherte Sicherungen</button>
                <button class="btn btn-secondary btn-sm" id="btn-export-png-full" style="width: 100%;">
                  ${glyph('imageviewer')} Als PNG exportieren
                </button>
            </div>
          </div>

          <!-- Tab: Help -->
          <div class="sidebar-content" id="tab-help">
            <div class="sidebar-header">
              <h3>Hilfe</h3>
            </div>
            <div class="help-content" style="font-size: 0.9rem; line-height: 1.4;">
              <h4 style="margin: 12px 0 6px; font-size: 1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 4px;">Allgemein</h4>
              <p><strong>Modus:</strong> Hammer (Entwurf) / Play (Simulation)</p>
              <p><strong>Zoom:</strong> Mausrad / Pinch</p>

              <h4 style="margin: 16px 0 6px; font-size: 1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 4px;">Desktop (Maus)</h4>
              <p><strong>Kabel:</strong> Rechtsklick auf Startgerät + Ziehen zum Ziel</p>
              <p><strong>Verschieben:</strong> Gerät ziehen</p>
              <p><strong>Menü:</strong> Rechtsklick auf Gerät</p>

              <h4 style="margin: 16px 0 6px; font-size: 1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 4px;">Touch (Mobile)</h4>
              <p><strong>Kabel:</strong> "Kabel"-Item wählen &rarr; Start tippen &rarr; Ziel tippen</p>
              <p><strong>Hinzufügen:</strong> Item wählen &rarr; Auf Fläche tippen</p>
              <p><strong>Verschieben:</strong> Gerät mit 1 Finger ziehen</p>
              <p><strong>Bearbeiten:</strong> Doppeltippen</p>
              <p><strong>Menü:</strong> Lang drücken (0.5s)</p>

              <p style="margin-top: 16px; color: var(--text-muted); font-size: 0.75rem; border-top: 1px dashed var(--border-color); padding-top: 8px;">
                <strong>Info:</strong> PCs/Notebooks (1 Port), Switches (8 Ports), Router (mehrere IP-Interfaces).
              </p>
            </div>
          </div>

          <!-- Tab: Config (Mobile Only Holder) -->
          <div class="sidebar-content" id="tab-config">
            <!-- Config Panel is nested here in DOM, but positioned fixed on Desktop -->
            <aside class="config-panel" id="config-panel">
              <div class="config-header">
                <h3 id="config-title">${i18n.t('config.name')}</h3>
                <button class="btn btn-icon btn-danger" id="btn-delete" data-tooltip="${i18n.t('actions.delete')}">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </div>
              <div class="config-content" id="config-content">
                <p style="color: var(--text-secondary);">Wähle ein Gerät oder Kabel aus.</p>
              </div>
            </aside>
          </div>
        </aside>

        <section class="canvas-container" id="canvas-container" tabindex="0" aria-label="Netzwerk-Arbeitsfläche">
          <div class="canvas-tools" aria-label="Ansicht steuern">
            <button class="btn btn-secondary" id="btn-zoom-out" aria-label="Verkleinern">−</button>
            <button class="btn btn-secondary" id="btn-fit" aria-label="Netzwerk einpassen">${glyph('fit')}</button>
            <button class="btn btn-secondary" id="btn-zoom-in" aria-label="Vergrößern">+</button>
          </div><div class="canvas-hint" id="canvas-hint" role="status">Gerät auswählen und auf die Fläche tippen</div>
        </section>
      </main>

      <footer class="status-bar">
        <div class="status-left">
          <div class="status-indicator">
            <span class="status-dot" id="status-dot"></span>
            <span id="status-text">${i18n.t('app.designMode')}</span>
          </div>
        </div>
        <div class="status-right">
          <span id="device-count">Geräte: 0</span>
          <span id="connection-count">Verbindungen: 0</span>
        </div>
      </footer>
    `;
}
