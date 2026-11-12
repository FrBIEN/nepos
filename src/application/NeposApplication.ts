import { ProjectHistory } from './ProjectHistory';
import { preserveModems, restoreDesignCables } from '../hardware/restoreDesignGraph';
import { SimulationController } from '../application/SimulationController';
import { ModeControls } from '../ui/ModeControls';
import { DeviceConfiguration } from '../ui/config/DeviceConfiguration';
import { ProjectController } from '../application/ProjectController';
import { ProjectFileActions } from '../ui/ProjectFileActions';
import { DesktopManager } from '../ui/DesktopManager';
import { Lifetime } from '../core/Lifetime';
import { renderApplicationShell } from '../ui/ApplicationShell';
import { createApplicationContext, type ApplicationContext } from '../application/ApplicationContext';
import { showNotice } from '../ui/Dialogs';
// Application composition and network-workspace interactions.
import { i18n, Locale } from '../i18n';
import { Events } from '../core/EventBus';
import { NetworkCanvas } from '../ui/NetworkCanvas';
import { glyph } from '../ui/Glyphs';
import { reconcileWireless } from '../hardware/Wireless';
import { Host, createRechner, createNotebook, createSwitch, createRouter, createModem, Knoten, Kabel, Switch, Vermittlungsrechner, Modem } from '../hardware';
export class NeposApplication {
    private syncingWireless = false;
    private syncWireless(): void {
        if (!this.canvas || this.syncingWireless || this.isSimulationMode)
            return;
        this.syncingWireless = true;
        try {
            this.canvas.setCables(reconcileWireless(this.canvas.getNodes(), this.canvas.getCables()));
        }
        finally {
            this.syncingWireless = false;
        }
    }
    private canvas: NetworkCanvas | null = null;
    private selectedDevice: Knoten | null = null;
    private selectedCable: Kabel | null = null;
    private mode: SimulationController;
    private modeControls: ModeControls;
    private get isSimulationMode(): boolean { return this.mode.isSimulation; }
    private canvasFocused: boolean = false;
    private selectedDeviceType: string | null = null;
    private connectionStartNode: Knoten | null = null;
    private history?: ProjectHistory;
    private project!: ProjectController;
    private files!: ProjectFileActions;
    private desktops: DesktopManager;
    private scope = new Lifetime();
    private configuration: DeviceConfiguration;
    constructor(private context: ApplicationContext = createApplicationContext()) {
        this.desktops = new DesktopManager(this.context);
        this.modeControls = new ModeControls(this.context);
        this.mode = new SimulationController({ context: this.context, workspace: { nodes: () => this.canvas?.getNodes() ?? [], cables: () => this.canvas?.getCables() ?? [] }, windows: this.desktops,
            canChange: () => !this.scope.disposed && !this.project?.busy,
            onMode: mode => {
                this.canvas?.setDraggingEnabled(mode === 'design');
                this.canvas?.setSimulationMode(mode === 'simulation');
                this.modeControls.render(mode);
                this.history?.setEnabled(mode === 'design');
                if (this.selectedDevice)
                    this.configuration.showConfigPanel(this.selectedDevice);
                this.canvas?.triggerResize();
            },
            onPlayback: () => this.modeControls.playback(), onHost: host => {
                if (this.selectedDevice === host)
                    this.configuration.showConfigPanel(host);
            } });
        this.scope.add(() => this.mode.dispose());
        this.configuration = new DeviceConfiguration({ dependencies: this.context, isSimulation: () => this.isSimulationMode, nodes: () => this.canvas?.getNodes() ?? [], openDesktop: host => this.desktops.open(host),
            refresh: node => this.configuration.showConfigPanel(node), changed: () => { this.updateStatusBar(); this.project?.scheduleSave(); this.history?.schedule(); }, deleteCable: cable => { this.canvas?.removeCable(cable.getId()); this.selectedCable = null; this.configuration.clear(); this.updateStatusBar(); } });
        this.scope.add(() => this.configuration.dispose());
        this.scope.add(() => this.context.packets.dispose());
        i18n.init();
        this.render();
        const updateViewport = () => document.documentElement.style.setProperty('--visual-height', `${window.visualViewport?.height ?? window.innerHeight}px`);
        this.scope.listen(window.visualViewport, 'resize', updateViewport);
        updateViewport();
        this.setupEventListeners();
        this.initCanvas();
    }
    dispose(): void { this.project.persist(); this.scope.dispose(); this.context.runtime.dispose(); this.modeControls.render('design'); }
    private render(): void {
        const root = document.getElementById('app');
        if (root)
            renderApplicationShell(root);
    }
    private initCanvas(): void {
        this.canvas = new NetworkCanvas('canvas-container', this.context.runtime);
        const canvas = this.canvas;
        this.project = new ProjectController({ store: this.context.store, scenarios: this.context.scenarios, services: this.context.services, network: this.context.network,
            windows: this.desktops, workspace: { nodes: () => canvas.getNodes(), cables: () => canvas.getCables(), documents: () => canvas.getDocElements().map(({ selected, ...element }) => element),
                replace: (nodes, cables, documents, preserveConnections = false) => {
                    const configs = cables.map(cable => cable.toJSON()!);
                    const preserved = preserveConnections ? preserveModems(canvas.getNodes(), nodes) : new Set<Knoten>();
                    if (preserveConnections) cables.forEach(cable => cable.disconnect());
                    canvas.clear(preserved);
                    if (preserveConnections) { const restored = restoreDesignCables(nodes, configs); cables.splice(0, cables.length, ...restored); }
                    canvas.setNodes(nodes);
                    canvas.setCables(cables);
                    canvas.setDocElements(documents.map(element => ({ ...element, selected: false })));
                    this.selectedDevice = null;
                    this.selectedCable = null;
                    this.connectionStartNode = null;
                    this.configuration.clear();
                    canvas.fitNetwork();
                    this.updateStatusBar();
                } },
            onMetadata: (name, description) => { (document.getElementById('project-title') as HTMLInputElement).value = name; (document.getElementById('project-desc') as HTMLTextAreaElement).value = description; },
            onError: (message, error) => { console.error(message, error); document.getElementById('status-text')!.textContent = 'Speichern fehlgeschlagen – Projekt als Datei sichern'; },
            onReplaced: () => this.history?.reset(),
            onNew: () => { this.context.runtime.ids.reset(); }
        });
        this.project.restore();
        const historyChanged = () => {
            const undo = document.getElementById('btn-undo') as HTMLButtonElement, redo = document.getElementById('btn-redo') as HTMLButtonElement;
            if (undo) undo.disabled = !this.history?.canUndo;
            if (redo) redo.disabled = !this.history?.canRedo;
        };
        this.history = new ProjectHistory(() => this.project.capture(), project => this.project.applyHistory(project), historyChanged);
        historyChanged();
        this.scope.listen(canvas.getCanvasElement(), 'pointerdown', () => this.history?.flush(), {capture:true});
        this.scope.listen(window, 'pointerup', () => this.history?.flush());
        this.scope.listen(document.getElementById('config-content'), 'change', () => { this.project.scheduleSave(); this.history?.schedule(); });
        this.scope.add(() => this.history?.dispose());
        const travel = (redo: boolean) => { void (redo ? this.history!.redo() : this.history!.undo()).catch(error => showNotice(String(error), this.scope.signal)); };
        this.scope.listen(document.getElementById('btn-undo'), 'click', () => travel(false));
        this.scope.listen(document.getElementById('btn-redo'), 'click', () => travel(true));
        this.scope.listen(document, 'keydown', event => {
            const target = event.target as HTMLElement;
            if (this.isSimulationMode || document.querySelector('dialog[open]') || target.closest('input,textarea,[contenteditable="true"]') || !(event.ctrlKey || event.metaKey) || event.altKey) return;
            if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') { event.preventDefault(); travel(event.shiftKey || event.key.toLowerCase() === 'y'); }
        });
        this.files = new ProjectFileActions(this.project, () => this.isSimulationMode);
        this.scope.add(() => this.project.dispose());
        this.scope.add(() => this.files.dispose());
        this.scope.add(() => this.desktops.dispose());
        this.scope.add(() => canvas.destroy());
        if (this.project.recoveryMessage) {
            this.files.showRecovery();
            document.getElementById('status-text')!.textContent = 'Wiederherstellung prüfen – automatisches Speichern gesperrt';
        }
        const container = document.getElementById('canvas-container');
        this.scope.listen(container, 'mousedown', () => { this.canvasFocused = true; container?.focus(); });
        this.scope.listen(container, 'blur', () => { this.canvasFocused = false; });
        this.scope.listen(window, 'pagehide', () => this.project.persist());
        const metadata = () => { this.project.setMetadata((document.getElementById('project-title') as HTMLInputElement).value, (document.getElementById('project-desc') as HTMLTextAreaElement).value); this.history?.schedule(); };
        this.scope.listen(document.getElementById('project-title'), 'input', metadata);
        this.scope.listen(document.getElementById('project-desc'), 'input', metadata);
        for (const event of [Events.DEVICE_ADDED, Events.DEVICE_REMOVED, Events.DEVICE_MOVED, Events.DOC_ELEMENT_CHANGED, Events.CABLE_ADDED, Events.CABLE_REMOVED, Events.SERVICE_STATE_CHANGED])
            this.scope.add(this.context.events.on(event, () => { this.project.scheduleSave(); this.history?.schedule(); }).unsubscribe);
        this.scope.add(this.context.events.on(Events.DEVICE_CONFIG_CHANGED, ({ device }: {
            device: Knoten;
        }) => {
            this.syncWireless();
            this.project.scheduleSave();
            this.history?.schedule();
            if (device && !(device instanceof Modem && device.getStatus() === 'connecting') && this.selectedDevice?.getId() === device.getId())
                this.configuration.showConfigPanel(this.selectedDevice);
        }).unsubscribe);
        // UI Interaction Logic
        this.scope.add(this.context.events.on(Events.SELECTION_CLEARED, (data: {
            x?: number;
            y?: number;
        }) => {
            // If we have a selected device type for placement (Touch/Click mode)
            if (this.selectedDeviceType && this.canvas && data && typeof data.x === 'number' && typeof data.y === 'number') {
                const screenX = data.x;
                const screenY = data.y;
                const worldPos = this.canvas.screenToWorld(screenX, screenY);
                const deviceType = this.selectedDeviceType;
                // Handle documentation elements
                if (deviceType === 'textbox' || deviceType === 'label' || deviceType === 'rectangle') {
                    this.canvas.addDocElement(deviceType, worldPos);
                }
                else {
                    let device: Knoten;
                    switch (deviceType) {
                        case 'rechner':
                            device = createRechner({ position: worldPos }, this.context.runtime);
                            break;
                        case 'notebook':
                            device = createNotebook({ position: worldPos }, this.context.runtime);
                            break;
                        case 'switch':
                            device = createSwitch({ position: worldPos }, this.context.runtime);
                            break;
                        case 'router':
                            device = createRouter({ position: worldPos }, this.context.runtime);
                            break;
                        case 'modem':
                            device = createModem({ position: worldPos }, this.context.runtime);
                            break;
                        default: return;
                    }
                    this.canvas.addNode(device);
                    this.context.events.emit(Events.DEVICE_ADDED, { device });
                }
                // Reset Selection
                this.selectedDeviceType = null;
                this.connectionStartNode = null;
                document.querySelectorAll('.device-item').forEach(el => el.classList.remove('selected'));
                document.body.style.cursor = 'default';
                return;
            }
            // Default behavior: Switch to Devices tab (only in Design Mode)
            if (!this.isSimulationMode) {
                const devicesTab = document.querySelector('.tab-btn[data-tab="devices"]') as HTMLElement;
                devicesTab?.click();
            }
        }).unsubscribe);
        this.scope.add(this.context.events.on(Events.DEVICE_SELECTED, (data: {
            device: Knoten;
        }) => {
            this.selectedDevice = data.device;
            this.selectedCable = null;
            if (data.device) {
                if (this.selectedDeviceType === 'cable') {
                    // Handle Cable Creation Mode
                    if (!this.connectionStartNode) {
                        // Step 1: Select First Node
                        this.connectionStartNode = data.device;
                        const hint = document.getElementById('canvas-hint');
                        if (hint)
                            hint.textContent = 'Jetzt das Zielgerät antippen';
                    }
                    else {
                        // Step 2: Select Second Node
                        if (this.connectionStartNode !== data.device) {
                            // Create connection
                            this.createCableBetween(this.connectionStartNode, -1, data.device, -1);
                            // Reset start node
                            this.connectionStartNode = null;
                            this.canvas?.deselectAll();
                        }
                    }
                }
                else {
                    // Normal Mode: Show Config
                    this.configuration.showConfigPanel(data.device);
                }
            }
        }).unsubscribe);
        this.updateStatusBar();
    }
    private setupEventListeners(): void {
        this.scope.listen(document.getElementById('btn-panel'), 'click', () => {
            const open = document.getElementById('sidebar')?.classList.toggle('open');
            document.getElementById('btn-panel')?.setAttribute('aria-expanded', String(open));
        });
        this.scope.listen(document.getElementById('btn-zoom-in'), 'click', () => this.canvas?.zoomBy(1.25));
        this.scope.listen(document.getElementById('btn-zoom-out'), 'click', () => this.canvas?.zoomBy(0.8));
        this.scope.listen(document.getElementById('btn-fit'), 'click', () => this.canvas?.fitNetwork());
        document.querySelectorAll<HTMLButtonElement>('[data-tooltip]').forEach(button => { button.setAttribute('aria-label', button.dataset.tooltip!); button.title = button.dataset.tooltip!; });
        document.querySelectorAll<HTMLElement>('.device-item').forEach(item => {
            item.tabIndex = 0;
            item.setAttribute('role', 'button');
            this.scope.listen(item, 'keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    item.click();
                }
            });
        });
        // Mode toggle
        this.scope.listen(document.getElementById('mode-design'), 'click', () => {
            this.mode.change('design');
        });
        this.scope.listen(document.getElementById('mode-simulation'), 'click', () => {
            this.mode.change('simulation');
        });
        // Packet log toggle
        this.scope.listen(document.getElementById('btn-packet-log'), 'click', () => {
            this.context.packets.toggle();
        });
        // Speed control
        const speedSlider = document.getElementById('simulation-speed') as HTMLInputElement;
        const speedValue = document.getElementById('speed-value');
        this.scope.listen(speedSlider, 'input', () => {
            const speed = parseInt(speedSlider.value, 10);
            if (speedValue)
                speedValue.textContent = `${speed}%`;
            this.context.network.setSimulationSpeed(speed);
        });
        this.scope.listen(document.getElementById('btn-play-pause'), 'click', () => this.mode.togglePause());
        // Legacy cable blink listener removed
        // eventBus.on('cable:blink', ...);
        // File operations (only in design mode)
        // Tab Navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            this.scope.listen(btn, 'click', () => {
                // Remove active class from all buttons and contents
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.sidebar-content').forEach(c => c.classList.remove('active'));
                // Add active to clicked button
                btn.classList.add('active');
                // Show corresponding content
                const tabId = (btn as HTMLElement).dataset.tab;
                const content = document.getElementById(`tab-${tabId}`);
                if (content)
                    content.classList.add('active');
                // Mobile-specific config panel handling is done via CSS (display:block on tab content)
            });
        });
        // Explicit PNG Export button listener (if moved inside Info tab)
        this.scope.listen(document.getElementById('btn-export-png-full'), 'click', () => {
            if (this.canvas) {
                const title = (document.getElementById('project-title') as HTMLInputElement)?.value || 'network-diagram';
                this.canvas.exportFullNetworkAsPNG(`${title}.png`);
            }
        });
        // Duplicate listener removed
        // Language selector
        this.scope.listen(document.getElementById('lang-select'), 'change', (e) => {
            const locale = (e.target as HTMLSelectElement).value as Locale;
            i18n.setLocale(locale);
            if (!this.project.persist()) {
                void showNotice('Die Sprache wird erst nach erfolgreichem Speichern neu geladen. Sichern Sie das Projekt als Datei.');
                return;
            }
            window.location.reload();
        });
        // Text annotation button - visible in design mode only
        this.scope.listen(document.getElementById('btn-add-text'), 'click', () => {
            if (!this.isSimulationMode && this.canvas) {
                this.canvas.addDocElement('textbox', { x: 200, y: 200 });
            }
        });
        // Delete button - only in design mode
        this.scope.listen(document.getElementById('btn-delete'), 'click', () => {
            this.history?.flush();
            if (this.isSimulationMode)
                return;
            this.deleteSelected();
        });
        // Drag and drop from palette
        document.querySelectorAll('.device-item[draggable="true"]').forEach(item => {
            this.scope.listen(item, 'dragstart', (e) => {
                if (this.isSimulationMode) {
                    e.preventDefault();
                    return;
                }
                const deviceType = (e.target as HTMLElement).closest('.device-item')?.getAttribute('data-device');
                if (deviceType) {
                    (e as DragEvent).dataTransfer?.setData('device-type', deviceType);
                }
            });
            // Tap/Click to Select (Touch-friendly fallback)
            this.scope.listen(item, 'click', (e) => {
                if (this.isSimulationMode)
                    return;
                const deviceType = (e.currentTarget as HTMLElement).getAttribute('data-device');
                // Remove active class from all
                document.querySelectorAll('.device-item').forEach(el => el.classList.remove('selected'));
                if (this.selectedDeviceType === deviceType) {
                    // Deselect
                    this.selectedDeviceType = null;
                    document.body.style.cursor = 'default';
                }
                else {
                    // Select
                    this.selectedDeviceType = deviceType || null;
                    (e.currentTarget as HTMLElement).classList.add('selected');
                    document.getElementById('sidebar')?.classList.remove('open');
                    document.getElementById('btn-panel')?.setAttribute('aria-expanded', 'false');
                    const hint = document.getElementById('canvas-hint');
                    if (hint)
                        hint.textContent = deviceType === 'cable' ? 'Startgerät antippen, dann Zielgerät' : 'Zum Platzieren auf die Fläche tippen';
                    document.body.style.cursor = 'crosshair';
                }
            });
        });
        const canvasContainer = document.getElementById('canvas-container');
        this.scope.listen(canvasContainer, 'dragover', (e) => {
            if (this.isSimulationMode)
                return;
            e.preventDefault();
        });
        this.scope.listen(canvasContainer, 'drop', (e) => {
            if (this.isSimulationMode || !canvasContainer)
                return;
            e.preventDefault();
            const deviceType = (e as DragEvent).dataTransfer?.getData('device-type');
            if (deviceType && this.canvas) {
                const rect = canvasContainer.getBoundingClientRect();
                const screenX = e.clientX - rect.left;
                const screenY = e.clientY - rect.top;
                // Convert screen coordinates to world coordinates (accounting for pan/zoom)
                const worldPos = this.canvas.screenToWorld(screenX, screenY);
                // Handle documentation elements
                if (deviceType === 'textbox' || deviceType === 'label' || deviceType === 'rectangle') {
                    this.canvas.addDocElement(deviceType, worldPos);
                    return;
                }
                let device: Knoten;
                switch (deviceType) {
                    case 'rechner':
                        device = createRechner({ position: worldPos }, this.context.runtime);
                        break;
                    case 'notebook':
                        device = createNotebook({ position: worldPos }, this.context.runtime);
                        break;
                    case 'switch':
                        device = createSwitch({ position: worldPos }, this.context.runtime);
                        break;
                    case 'router':
                        device = createRouter({ position: worldPos }, this.context.runtime);
                        break;
                    case 'modem':
                        device = createModem({ position: worldPos }, this.context.runtime);
                        break;
                    default:
                        return;
                }
                this.canvas.addNode(device);
                this.updateStatusBar();
            }
        });
        // Documentation toggle
        this.scope.listen(document.getElementById('doc-toggle'), 'click', () => {
            const docTools = document.getElementById('doc-tools');
            const arrow = document.querySelector('.toggle-arrow');
            docTools?.classList.toggle('collapsed');
            arrow?.classList.toggle('collapsed');
        });
        // Setup listener for log updates
        this.setupDeviceConfigChangeListener();
        // Keyboard shortcuts - only delete when canvas is focused AND in design mode
        this.scope.listen(document, 'keydown', (e) => {
            // Only handle delete if canvas is focused and we're in design mode
            if ((e.key === 'Delete' || e.key === 'Backspace') &&
                this.canvasFocused &&
                !this.isSimulationMode &&
                !(document.activeElement instanceof HTMLInputElement) &&
                !(document.activeElement instanceof HTMLTextAreaElement)) {
                e.preventDefault();
                this.deleteSelected();
            }
        });
        // Event bus listeners
        // Context Menu Logic
        this.scope.listen(canvasContainer, 'contextmenu', (e) => {
            e.preventDefault();
            if (!this.canvas || !canvasContainer)
                return;
            // Disable Context Menu in Design Mode (User Request)
            if (!this.isSimulationMode)
                return;
            const rect = canvasContainer.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;
            const worldPos = this.canvas.screenToWorld(screenX, screenY);
            const node = this.canvas.findNodeAt(worldPos);
            // Remove existing context menu
            document.getElementById('custom-context-menu')?.remove();
            if (node) {
                // Build Menu
                const menu = document.createElement('div');
                menu.id = 'custom-context-menu';
                Object.assign(menu.style, {
                    position: 'absolute',
                    left: `${e.clientX}px`,
                    top: `${e.clientY}px`,
                    background: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '4px 0',
                    zIndex: '3000',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
                });
                const items: {
                    label: string;
                    action: () => void;
                }[] = [];
                // 1. Data Exchange
                // 1. Data Exchange (Host only)
                if (node.getType() === 'rechner' || node.getType() === 'notebook') {
                    items.push({
                        label: 'Datenaustausch anzeigen',
                        action: () => {
                            this.context.packets.showForDevice(String(node.getId()));
                        }
                    });
                }
                // 3. Desktop (Host)
                if (node.getType() === 'rechner' || node.getType() === 'notebook') {
                    items.push({
                        label: 'Desktop anzeigen',
                        action: () => {
                            this.context.events.emit(Events.DESKTOP_OPEN, { node });
                        }
                    });
                }
                items.forEach(item => {
                    const div = document.createElement('div');
                    div.textContent = item.label;
                    Object.assign(div.style, {
                        padding: '8px 16px',
                        cursor: 'pointer',
                        color: '#e2e8f0',
                        fontSize: '14px'
                    });
                    div.onmouseenter = () => div.style.background = '#334155';
                    div.onmouseleave = () => div.style.background = 'transparent';
                    div.onclick = () => {
                        item.action();
                        menu.remove();
                    };
                    menu.appendChild(div);
                });
                document.body.appendChild(menu);
                const closeMenu = () => {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                };
                this.scope.timeout(() => this.scope.listen(document, 'click', closeMenu), 0);
            }
        });
        this.scope.add(this.context.events.on(Events.CABLE_DRAWING_END, (data: {
            startNode: Knoten;
            startPort: number;
            endNode: Knoten;
            endPort: number;
        }) => {
            if (!this.isSimulationMode) {
                this.createCableBetween(data.startNode, data.startPort, data.endNode, data.endPort);
            }
        }).unsubscribe);
        this.scope.add(this.context.events.on(Events.DESKTOP_OPEN, (data: {
            node: Knoten;
        }) => {
            if (data.node instanceof Host && this.isSimulationMode) {
                this.desktops.open(data.node);
            }
        }).unsubscribe);
        this.scope.add(this.context.events.on(Events.DEVICE_ADDED, () => this.updateStatusBar()).unsubscribe);
        this.scope.add(this.context.events.on(Events.DEVICE_REMOVED, (data: {
            device: Knoten;
        }) => {
            this.updateStatusBar();
            // Clean up server instances if a host is removed
            if (data.device instanceof Host) {
                this.context.hostDhcpServerManager.removeServer(data.device.getId());
                this.context.hostServerManager.removeServer(data.device.getId());
            }
        }).unsubscribe);
        this.scope.add(this.context.events.on(Events.CABLE_ADDED, () => this.updateStatusBar()).unsubscribe);
        this.scope.add(this.context.events.on(Events.CABLE_REMOVED, () => this.updateStatusBar()).unsubscribe);
        // Cable selection
        this.scope.add(this.context.events.on('cable:selected', (data: {
            cable: Kabel;
        }) => {
            this.selectedCable = data.cable;
            this.selectedDevice = null;
            this.configuration.showCable(data.cable);
        }).unsubscribe);
        // Context menu on nodes
        this.scope.add(this.context.events.on('node:contextmenu', (data: {
            node: Knoten;
            screenX: number;
            screenY: number;
        }) => {
            this.showContextMenu(data.node, data.screenX, data.screenY);
        }).unsubscribe);
        // Modem Log Update (Efficient UI update without full re-render)
        this.scope.add(this.context.events.on('modem:log', (data: {
            id: string;
            log: string;
        }) => {
            // Only update if the modem is currently selected and panel is open
            if (this.selectedDevice && this.selectedDevice.getId() === data.id) {
                const logDiv = document.getElementById('modem-debug-log');
                if (logDiv) {
                    logDiv.innerText += (logDiv.innerText ? '\n' : '') + data.log;
                    logDiv.scrollTop = logDiv.scrollHeight;
                }
            }
        }).unsubscribe);
        // Legacy visualization removed (User Request)
    }
    private deleteSelected(): void {
        this.history?.flush();
        if (this.selectedCable && this.canvas) {
            this.canvas.removeCable(this.selectedCable.getId());
            this.selectedCable = null;
            this.configuration.clear();
            this.updateStatusBar();
        }
        else if (this.selectedDevice && this.canvas) {
            if (this.selectedDevice instanceof Modem)
                this.selectedDevice.disconnect();
            this.canvas.removeNode(this.selectedDevice.getId());
            this.context.services.restore(this.context.services.snapshot(this.canvas.getNodes()), this.canvas.getNodes());
            this.context.network.updateTopology(this.canvas.getNodes(), this.canvas.getCables());
            this.selectedDevice = null;
            this.configuration.clear();
            this.updateStatusBar();
        }
    }
    // Refresh config panel on device changes (e.g. Modem logs/status)
    private setupDeviceConfigChangeListener(): void {
        this.scope.add(this.context.events.on(Events.DEVICE_CONFIG_CHANGED, (data) => {
            if (data && data.device) {
                // Specifically target the log box if it exists
                const logBox = document.getElementById('modem-debug-log');
                if (logBox && data.device === this.selectedDevice && data.device instanceof Modem) {
                    logBox.textContent = data.device.getLogs().join('\n');
                    logBox.scrollTop = logBox.scrollHeight;
                }
            }
        }).unsubscribe);
    }
    private showContextMenu(node: Knoten, screenX: number, screenY: number): void {
        // Remove existing context menu
        this.hideContextMenu();
        // Only show for Host devices
        if (!(node instanceof Host))
            return;
        const host = node as Host;
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.id = 'context-menu';
        menu.style.left = `${screenX}px`;
        menu.style.top = `${screenY}px`;
        menu.innerHTML = `
      <div class="context-menu-item" data-action="desktop">
        <span class="context-menu-icon">${glyph('terminal')}</span>
        <span>Desktop anzeigen</span>
      </div>
      <div class="context-menu-item" data-action="packets">
        <span class="context-menu-icon">${glyph('packets')}</span>
        <span>Datenaustausch anzeigen</span>
      </div>
    `;
        document.body.appendChild(menu);
        // Handle clicks
        menu.querySelectorAll('.context-menu-item').forEach(item => {
            this.scope.listen(item, 'click', () => {
                const action = (item as HTMLElement).dataset.action;
                if (action === 'desktop') {
                    this.desktops.open(host);
                }
                else if (action === 'packets') {
                    // Register device with packet log if needed
                    this.context.packets.registerDevice(host.getId(), host.getName(), host.getIP(), host.getNetworkInterface().getMAC());
                    this.context.packets.showForDevice(String(host.getId()));
                }
                this.hideContextMenu();
            });
        });
        // Close on click outside
        this.scope.timeout(() => {
            this.scope.listen(document, 'click', this.hideContextMenu.bind(this), { once: true });
        }, 10);
    }
    private hideContextMenu(): void {
        const existing = document.getElementById('context-menu');
        if (existing) {
            existing.remove();
        }
    }
    private createCableBetween(node1: Knoten, port1Hint: number, node2: Knoten, port2Hint: number): void {
        if (!this.canvas)
            return;
        // Check if hosts/modems already have a connection (only 1 interface)
        const isHostAlreadyConnected = (node: Knoten): boolean => {
            if (!(node instanceof Host) && !(node instanceof Modem))
                return false;
            return this.canvas!.getCables().some(c => c.isConnectedTo(node.getId()));
        };
        if (isHostAlreadyConnected(node1)) {
            void showNotice(`${node1.getName()} ist bereits verbunden. Dieses Gerät hat nur eine Schnittstelle.`);
            return;
        }
        if (isHostAlreadyConnected(node2)) {
            void showNotice(`${node2.getName()} ist bereits verbunden. Dieses Gerät hat nur eine Schnittstelle.`);
            return;
        }
        const cable = new Kabel(undefined, this.context.runtime);
        // Get interfaces
        const getInterface = (node: Knoten, portIndex: number) => {
            if (node instanceof Host) {
                return node.getNetworkInterface();
            }
            else if (node instanceof Switch) {
                return node.getPort(portIndex);
            }
            else if (node instanceof Vermittlungsrechner) {
                return node.getInterface(portIndex);
            }
            else if (node instanceof Modem) {
                return node.getNetworkInterface();
            }
            return null;
        };
        // Check if a port is already in use
        const isPortInUse = (node: Knoten, portIndex: number): boolean => {
            return this.canvas!.getCables().some(c => {
                const ep1 = c.getEndpoint1();
                const ep2 = c.getEndpoint2();
                if (ep1?.node.getId() === node.getId() && ep1.portIndex === portIndex)
                    return true;
                if (ep2?.node.getId() === node.getId() && ep2.portIndex === portIndex)
                    return true;
                return false;
            });
        };
        // Find first free port
        const findFreePort = (node: Knoten): number => {
            if (node instanceof Host || node instanceof Modem)
                return 0;
            const portCount = node.getPortCount();
            for (let i = 0; i < portCount; i++) {
                if (!isPortInUse(node, i))
                    return i;
            }
            return -1;
        };
        // Use hint if valid and port is free, otherwise find free port
        let port1 = (node1 instanceof Host) ? 0 : port1Hint;
        let port2 = (node2 instanceof Host) ? 0 : port2Hint;
        // Validate and adjust port selection
        if (port1 === -1 || isPortInUse(node1, port1)) {
            port1 = findFreePort(node1);
        }
        if (port2 === -1 || isPortInUse(node2, port2)) {
            port2 = findFreePort(node2);
        }
        if (port1 === -1 || port2 === -1) {
            void showNotice('Keine freien Ports verfügbar.');
            return;
        }
        const iface1 = getInterface(node1, port1);
        const iface2 = getInterface(node2, port2);
        if (!iface1 || !iface2) {
            console.warn('Could not get interfaces');
            return;
        }
        cable.connect({ node: node1, portIndex: port1, interface: iface1 }, true);
        cable.connect({ node: node2, portIndex: port2, interface: iface2 }, false);
        this.canvas.addCable(cable);
    }
    private updateStatusBar(): void {
        this.syncWireless();
        const deviceCount = document.getElementById('device-count');
        const connectionCount = document.getElementById('connection-count');
        if (this.canvas) {
            if (deviceCount)
                deviceCount.textContent = `Geräte: ${this.canvas.getNodes().length}`;
            if (connectionCount)
                connectionCount.textContent = `Verbindungen: ${this.canvas.getCables().length}`;
        }
    }
}
