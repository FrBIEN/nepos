import { Lifetime } from '../core/Lifetime';
import { Host } from '../hardware/Host';
import type { Knoten } from '../hardware/Knoten';
import { PacketJournal, type PacketLogEntry } from '../network/PacketJournal';
export type { PacketLogEntry, PacketLayer } from '../network/PacketJournal';
import { escapeHTML } from './html';
import { createDismissButton } from './DismissButton';
// PacketLog - Visualizes network packets with per-device tabs and expandable details
import { type EventBus, Events } from '../core/EventBus';
import { WindowManager } from './WindowManager';
interface DeviceInfo {
    id: string;
    name: string;
    ip: string;
    mac: string;
}
export class PacketLog {
    private element: HTMLElement | null = null;
    private scope = new Lifetime();
    private rows = new Lifetime();
    private tabs = new Lifetime();
    private isVisible: boolean = false;
    private devices: Map<string, DeviceInfo> = new Map();
    private activeDeviceId: string | null = null;
    private expandedRows: Set<number> = new Set();
    private isDragging: boolean = false;
    private isResizing: boolean = false;
    private dragOffset = { x: 0, y: 0 };
    private get entries(): PacketLogEntry[] { return this.journal.getEntries(); }
    constructor(private journal: PacketJournal, private events: EventBus) {
        this.scope.add(this.journal.subscribe(append => {
            if (!append)
                this.expandedRows.clear();
            this.updateUI(append);
        }));
        this.setupEventListeners();
    }
    private setupEventListeners(): void {
        // Track devices
        this.scope.add(this.events.on(Events.DEVICE_ADDED, ({ device }: {
            device: Knoten;
        }) => {
            if (device instanceof Host)
                this.registerDevice(device.getId(), device.getName(), device.getIP(), device.getMAC());
        }).unsubscribe);
        this.scope.add(this.events.on(Events.DEVICE_REMOVED, ({ device, id }: {
            device?: Knoten;
            id?: string;
        }) => {
            const key = id ?? device?.getId();
            if (key) {
                this.devices.delete(key);
                if (this.activeDeviceId === key)
                    this.activeDeviceId = null;
                this.updateTabs();
            }
        }).unsubscribe);
        this.scope.add(this.events.on(Events.TOPOLOGY_UPDATE, ({ hosts }: {
            hosts: Host[];
        }) => {
            this.devices.clear();
            for (const host of hosts)
                this.devices.set(host.getId(), { id: host.getId(), name: host.getName(), ip: host.getIP(), mac: host.getMAC() });
            if (this.activeDeviceId && !this.devices.has(this.activeDeviceId))
                this.activeDeviceId = null;
            this.updateTabs();
        }).unsubscribe);
    }
    registerDevice(id: string, name: string, ip: string, mac: string): void {
        this.devices.set(id, { id, name, ip, mac });
        this.updateTabs();
    }
    dispose(): void { this.scope.dispose(); this.element?.remove(); this.element = null; this.isVisible = false; this.devices.clear(); }
    clear(): void { this.journal.clear(); }
    getEntries(): PacketLogEntry[] { return this.journal.getEntries(); }
    show(deviceId?: string): void {
        if (deviceId !== undefined) {
            this.activeDeviceId = String(deviceId);
        }
        if (!this.element) {
            this.createUI();
        }
        this.element!.style.display = 'flex';
        this.isVisible = true;
        this.updateTabs();
        this.updateUI(false);
    }
    // ...
    private updateTabs(): void {
        this.tabs.dispose();
        this.tabs = this.scope.child();
        if (!this.element)
            return;
        const tabsContainer = this.element.querySelector('#packet-log-tabs');
        if (!tabsContainer)
            return;
        let tabsHtml = `<button class="packet-log-tab ${this.activeDeviceId === null ? 'active' : ''}" data-device-id="">Alle Geräte</button>`;
        for (const [id, dev] of this.devices) {
            const isActive = this.activeDeviceId === id;
            tabsHtml += `<button class="packet-log-tab ${isActive ? 'active' : ''}" data-device-id="${id}" title="${dev.ip}">${escapeHTML(dev.name)}</button>`;
        }
        tabsContainer.innerHTML = tabsHtml;
        tabsContainer.querySelectorAll('.packet-log-tab').forEach(tab => {
            this.tabs.listen(tab, 'click', () => {
                const deviceId = (tab as HTMLElement).dataset.deviceId || null;
                this.activeDeviceId = deviceId === '' ? null : deviceId;
                this.updateTabs();
                this.updateUI(false);
            });
        });
    }
    showForDevice(deviceId: string): void {
        this.show(String(deviceId));
    }
    hide(): void {
        if (this.element) {
            this.element.style.display = 'none';
        }
        this.isVisible = false;
    }
    toggle(): void {
        this.isVisible ? this.hide() : this.show();
    }
    private createUI(): void {
        const div = document.createElement('div');
        div.className = 'packet-log';
        div.innerHTML = `
      <div class="packet-log-header" id="packet-log-drag-handle">
        <h3>Datenaustausch</h3>
        <div class="packet-log-controls">
          <button class="btn btn-secondary btn-sm" id="packet-log-clear">Löschen</button>
        </div>
      </div>
      <div class="packet-log-tabs" id="packet-log-tabs"></div>
      <div class="packet-log-table-container">
        <table class="packet-log-table">
          <thead>
            <tr>
              <th style="width: 30px;"></th>
              <th>Nr.</th>
              <th>Zeit</th>
              <th>Quelle</th>
              <th>Ziel</th>
              <th>Protokoll</th>
              <th>App</th>
              <th>Info</th>
            </tr>
          </thead>
          <tbody id="packet-log-body"></tbody>
        </table>
      </div>
      <div class="packet-log-resize-handle" id="packet-log-resize"></div>
    `;
        document.body.appendChild(div);
        this.element = div;
        // Initial z-index
        WindowManager.bringToFront(div);
        // Bring to front on click
        this.scope.listen(div, 'mousedown', () => {
            if (this.element)
                WindowManager.bringToFront(this.element);
        });
        // Event listeners
        div.append(createDismissButton(() => this.hide(), 'Datenaustausch schließen'));
        this.scope.listen(div.querySelector('#packet-log-clear'), 'click', () => this.clear());
        // Drag functionality
        const dragHandle = div.querySelector('#packet-log-drag-handle') as HTMLElement;
        this.scope.listen(dragHandle, 'mousedown', (e) => this.startDrag(e));
        this.scope.listen(dragHandle, 'touchstart', (e) => this.startTouchDrag(e), { passive: false });
        // Resize functionality
        const resizeHandle = div.querySelector('#packet-log-resize') as HTMLElement;
        this.scope.listen(resizeHandle, 'mousedown', (e) => this.startResize(e));
        this.updateTabs();
    }
    private startDrag(e: MouseEvent): void {
        if ((e.target as HTMLElement).closest('button'))
            return;
        this.isDragging = true;
        const rect = this.element!.getBoundingClientRect();
        this.dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const onMove = (e: MouseEvent) => {
            if (this.isDragging && this.element) {
                this.element.style.left = `${e.clientX - this.dragOffset.x}px`;
                this.element.style.top = `${e.clientY - this.dragOffset.y}px`;
                this.element.style.right = 'auto';
                this.element.style.bottom = 'auto';
            }
        };
        const onUp = () => {
            this.isDragging = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        this.scope.listen(document, 'mousemove', onMove);
        this.scope.listen(document, 'mouseup', onUp);
    }
    private startTouchDrag(e: TouchEvent): void {
        if (e.touches.length !== 1)
            return;
        if ((e.target as HTMLElement).closest('button'))
            return;
        e.preventDefault();
        this.isDragging = true;
        const rect = this.element!.getBoundingClientRect();
        const touch = e.touches[0];
        this.dragOffset = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
        const onTouchMove = (e: TouchEvent) => {
            if (this.isDragging && this.element) {
                e.preventDefault();
                const touch = e.touches[0];
                this.element.style.left = `${touch.clientX - this.dragOffset.x}px`;
                this.element.style.top = `${touch.clientY - this.dragOffset.y}px`;
                this.element.style.right = 'auto';
                this.element.style.bottom = 'auto';
            }
        };
        const onTouchEnd = () => {
            this.isDragging = false;
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchEnd);
        };
        this.scope.listen(document, 'touchmove', onTouchMove, { passive: false });
        this.scope.listen(document, 'touchend', onTouchEnd);
    }
    private startResize(e: MouseEvent): void {
        e.preventDefault();
        this.isResizing = true;
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = this.element!.offsetWidth;
        const startHeight = this.element!.offsetHeight;
        const onMove = (e: MouseEvent) => {
            if (this.isResizing && this.element) {
                const newWidth = Math.max(400, startWidth + (e.clientX - startX));
                const newHeight = Math.max(300, startHeight + (e.clientY - startY));
                this.element.style.width = `${newWidth}px`;
                this.element.style.height = `${newHeight}px`;
            }
        };
        const onUp = () => {
            this.isResizing = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        this.scope.listen(document, 'mousemove', onMove);
        this.scope.listen(document, 'mouseup', onUp);
    }
    private updateUI(autoScroll: boolean): void {
        if (!this.element || !this.isVisible)
            return;
        this.rows.dispose();
        this.rows = this.scope.child();
        const tbody = this.element.querySelector('#packet-log-body');
        if (!tbody)
            return;
        // Filter entries
        let filteredEntries = this.entries;
        if (this.activeDeviceId) {
            const device = this.devices.get(this.activeDeviceId);
            console.log(`[PacketLog] Filtering for device ${this.activeDeviceId}. Found: ${!!device}`, device);
            if (device) {
                const { ip, mac } = device;
                // Case-insensitive comparisons for robustness
                const deviceMac = mac.toLowerCase();
                filteredEntries = this.entries.filter(e => {
                    // 1. Precise Match: relatedDeviceId (if present)
                    if (e.relatedDeviceId) {
                        return e.relatedDeviceId === this.activeDeviceId;
                    }
                    // 2. Fallback: IP/MAC Matching (Legacy/Generic)
                    const srcMac = (e.sourceMAC || '').toLowerCase();
                    const dstMac = (e.destMAC || '').toLowerCase();
                    const match = e.sourceIP === ip || e.destIP === ip ||
                        srcMac === deviceMac || dstMac === deviceMac ||
                        // Only show broadcasts if we don't have a specific device association
                        // (This is the fallback for "unknown observer" broadcasts)
                        (!e.relatedDeviceId && (e.destIP === '255.255.255.255' || dstMac === 'ff:ff:ff:ff:ff:ff'));
                    return match;
                });
            }
            else {
                // Device active but not found? Show nothing or warn.
                // If we show ALL, it's confusing. Let's show filtered (none) but maybe warn.
                console.warn(`[PacketLog] Device ${this.activeDeviceId} not found in registry!`);
                filteredEntries = []; // Show nothing if device is missing but selected
            }
        }
        const displayEntries = filteredEntries.slice(-100);
        tbody.innerHTML = displayEntries.map(entry => {
            const isExpanded = this.expandedRows.has(entry.id);
            const expandIcon = isExpanded ? '▼' : '▶';
            const rowStyle = entry.color ? `style="background-color: ${entry.color}20;"` : ''; // Light background
            const infoStyle = entry.color ? `style="color: ${entry.color}; font-weight: bold;"` : '';
            let html = `
        <tr class="packet-row packet-${entry.transport.toLowerCase()}" data-entry-id="${escapeHTML(entry.id)}" ${rowStyle}>
          <td class="expand-cell">${entry.layers?.length ? expandIcon : ''}</td>
          <td>${escapeHTML(entry.id)}</td>
          <td>${this.formatTime(entry.timestamp)}</td>
          <td>${this.formatSource(entry)}</td>
          <td>${this.formatDest(entry)}</td>
          <td><span class="protocol-badge protocol-${entry.transport.toLowerCase()}">${entry.transport}</span></td>
          <td>${entry.application !== '-' ? `<span class="protocol-badge protocol-${entry.application.toLowerCase()}">${entry.application}</span>` : '-'}</td>
          <td ${infoStyle}>${escapeHTML(entry.info)}</td>
        </tr>
      `;
            if (isExpanded && entry.layers) {
                html += `
          <tr class="packet-details-row">
            <td colspan="7">
              <div class="packet-details">
                ${entry.layers.map(layer => `
                  <div class="packet-layer">
                    <div class="packet-layer-header">${layer.name}</div>
                    <div class="packet-layer-fields">
                      ${layer.fields.map(f => `
                        <div class="packet-field ${f.key === 'Daten' ? 'packet-field-payload' : ''}">
                          <span class="packet-field-key">${f.key}:</span>
                          <span class="packet-field-value">${f.key === 'Daten' ? `<pre>${this.escapeHtml(f.value)}</pre>` : f.value}</span>
                        </div>
                      `).join('')}
                    </div>
                  </div>
                `).join('')}
              </div>
            </td>
          </tr>
        `;
            }
            return html;
        }).join('');
        // Add click listeners for expansion
        tbody.querySelectorAll('.packet-row').forEach(row => {
            this.rows.listen(row, 'click', () => {
                const entryId = parseInt((row as HTMLElement).dataset.entryId || '0', 10);
                if (this.expandedRows.has(entryId)) {
                    this.expandedRows.delete(entryId);
                }
                else {
                    this.expandedRows.add(entryId);
                }
                this.updateUI(false); // Don't auto-scroll on expand
            });
        });
        // Only auto-scroll for new entries, not on expand
        if (autoScroll) {
            const container = this.element.querySelector('.packet-log-table-container');
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }
    }
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    private formatTime(timestamp: number): string {
        const hours = Math.floor(timestamp / 3600000), minutes = Math.floor(timestamp / 60000) % 60, seconds = Math.floor(timestamp / 1000) % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(Math.floor(timestamp) % 1000).padStart(3, '0')}`;
    }
    private formatSource(entry: PacketLogEntry): string {
        if (entry.transport === 'ARP') {
            return `<span title="MAC Address">${escapeHTML(entry.sourceMAC)}</span>`;
        }
        if ((entry.transport === 'TCP' || entry.transport === 'UDP') && entry.sourcePort !== undefined && entry.sourcePort !== 0) {
            return `<span title="MAC: ${escapeHTML(entry.sourceMAC)}">${escapeHTML(entry.sourceIP)}:${escapeHTML(entry.sourcePort)}</span>`;
        }
        return `<span title="MAC: ${escapeHTML(entry.sourceMAC)}">${escapeHTML(entry.sourceIP)}</span>`;
    }
    private formatDest(entry: PacketLogEntry): string {
        if (entry.transport === 'ARP') {
            // For ARP Request, Dest MAC is Broadcast (ff:ff...)
            if (entry.destMAC === 'ff:ff:ff:ff:ff:ff') {
                return '<span title="Broadcast">Broadcast</span>';
            }
            return `<span title="MAC Address">${escapeHTML(entry.destMAC)}</span>`;
        }
        if ((entry.transport === 'TCP' || entry.transport === 'UDP') && entry.destPort !== undefined && entry.destPort !== 0) {
            return `<span title="MAC: ${escapeHTML(entry.destMAC)}">${escapeHTML(entry.destIP)}:${escapeHTML(entry.destPort)}</span>`;
        }
        return `<span title="MAC: ${escapeHTML(entry.destMAC)}">${escapeHTML(entry.destIP)}</span>`;
    }
}
