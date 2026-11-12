import type { RuntimeDependencies } from '../runtime/RuntimeDependencies';
import { legacyRuntime } from '../runtime/LegacyRuntime';
import { askText } from './Dialogs';
// NetworkCanvas - Main canvas for rendering network topology

import { Modem } from '../hardware/Modem';
import { Knoten } from '../hardware/Knoten';
import { Kabel } from '../hardware/Kabel';
import { Position } from '../core/types';
import { Events } from '../core/EventBus';

interface CanvasState {
    pan: Position;
    zoom: number;
    isDragging: boolean;
    isDraggingDoc: boolean;
    isResizing: boolean;
    resizeHandle: 'se' | null; // se = southeast (bottom-right corner)
    isPanning: boolean;
    isDrawingCable: boolean;
    selectedNodeId: string | null;
    selectedCableId: string | null;
    selectedDocElementId: string | null;
    cableStartNode: Knoten | null;
    cableStartPort: number;
    cablePreviewEnd: Position | null;
    dragOffset: Position;
    draggingEnabled: boolean;
    spacePressed: boolean;
    // Touch state
    lastTouchDistance: number;
    lastTouchCenter: Position | null;
    lastTapTime: number;
    longPressTimeout: any;
    touchStartPosition: Position | null;
}

// Documentation elements
interface DocElement {
    id: string;
    type: 'textbox' | 'label' | 'rectangle';
    position: Position;
    text: string;
    width: number;
    height: number;
    color: string;
    selected: boolean;
}

import { Icons, deviceIconName } from './IconManager';

export class NetworkCanvas {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private nodes: Knoten[] = [];
    private cables: Kabel[] = [];
    private docElements: DocElement[] = [];
    private state: CanvasState;
    private images: Map<string, HTMLImageElement> = new Map();
    private animationFrameId: number | null = null;
    private listenerController = new AbortController();
    private resizeObserver: ResizeObserver;
    private touchMoved = false;
    private lastTapPosition: Position | null = null;
    private simulationMode: boolean = false;

    constructor(containerId: string, private runtime: RuntimeDependencies = legacyRuntime) {
        const container = document.getElementById(containerId);
        if (!container) {
            throw new Error(`Container #${containerId} not found`);
        }

        // Preload existing images
        this.preloadImages();

        this.canvas = document.createElement('canvas');
        this.canvas.id = 'network-canvas';
        container.appendChild(this.canvas);

        const ctx = this.canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Could not get 2D context');
        }
        this.ctx = ctx;

        this.state = {
            pan: { x: 0, y: 0 },
            zoom: 1,
            isDragging: false,
            isDraggingDoc: false,
            isResizing: false,
            resizeHandle: null,
            isPanning: false,
            isDrawingCable: false,
            selectedNodeId: null,
            selectedCableId: null,
            selectedDocElementId: null,
            cableStartNode: null,
            cableStartPort: 0,
            cablePreviewEnd: null,
            dragOffset: { x: 0, y: 0 },
            draggingEnabled: true,
            spacePressed: false,
            lastTouchDistance: 0,
            lastTouchCenter: null,
            lastTapTime: 0,
            longPressTimeout: null,
            touchStartPosition: null,
        };

        this.setupEventListeners();
        this.resize();
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
        this.startRenderLoop();
    }

    setDraggingEnabled(enabled: boolean): void {
        this.state.draggingEnabled = enabled;
    }

    setSimulationMode(enabled: boolean): void {
        this.simulationMode = enabled;
    }

    private resize(): void {
        const parent = this.canvas.parentElement;
        if (parent) {
            const ratio = window.devicePixelRatio || 1;
            this.canvas.width = Math.round(parent.clientWidth * ratio);
            this.canvas.height = Math.round(parent.clientHeight * ratio);
            this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
    }

    triggerResize(): void {
        // Allow external callers to trigger resize after layout changes
        setTimeout(() => this.resize(), 50);
    }

    zoomBy(factor: number): void {
        const x = this.canvas.clientWidth / 2, y = this.canvas.clientHeight / 2;
        const world = this.screenToWorld(x, y);
        this.state.zoom = Math.max(0.15, Math.min(4, this.state.zoom * factor));
        this.state.pan = { x: x - world.x * this.state.zoom, y: y - world.y * this.state.zoom };
    }
    fitNetwork(): void {
        if (!this.nodes.length) { this.state.zoom = 1; this.state.pan = { x: 0, y: 0 }; return; }
        const xs = this.nodes.map(n => n.getPosition().x), ys = this.nodes.map(n => n.getPosition().y);
        const minX = Math.min(...xs) - 70, maxX = Math.max(...xs) + 70, minY = Math.min(...ys) - 70, maxY = Math.max(...ys) + 70;
        const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
        this.state.zoom = Math.max(0.15, Math.min(1.5, width / (maxX - minX), height / (maxY - minY)));
        this.state.pan = { x: (width - (minX + maxX) * this.state.zoom) / 2, y: (height - (minY + maxY) * this.state.zoom) / 2 };
    }
    adjustPan(dx: number, dy: number): void {
        this.state.pan.x += dx;
        this.state.pan.y += dy;
    }

    private preloadImages(): void {
        // Map node types to Icons
        this.images.set('rechner', this.createImage(Icons.rechner));
        this.images.set('notebook', this.createImage(Icons.notebook));
        this.images.set('switch', this.createImage(Icons.switch));
        this.images.set('accesspoint', this.createImage(Icons.accesspoint));
        this.images.set('router', this.createImage(Icons.router));
        this.images.set('modem', this.createImage(Icons.modem));
    }

    private createImage(src: string): HTMLImageElement {
        const img = new Image();
        img.src = src;
        img.onload = () => this.render();
        return img;
    }

    private setupEventListeners(): void {
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        window.addEventListener('mousemove', this.handleMouseMove.bind(this), { signal: this.listenerController.signal });
        window.addEventListener('mouseup', this.handleMouseUp.bind(this), { signal: this.listenerController.signal });
        this.canvas.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });
        this.canvas.addEventListener('dblclick', this.handleDoubleClick.bind(this));
        this.canvas.addEventListener('contextmenu', this.handleContextMenu.bind(this));

        // Keyboard events for space panning
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !e.repeat) {
                // Prevent default scroll behavior when over canvas
                if (document.activeElement === document.body || document.activeElement === this.canvas) {
                    e.preventDefault();
                }
                this.state.spacePressed = true;
                this.canvas.style.cursor = 'grab';
            }
        }, { signal: this.listenerController.signal });
        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                this.state.spacePressed = false;
                if (!this.state.isPanning) {
                    this.canvas.style.cursor = 'default';
                }
            }
        }, { signal: this.listenerController.signal });

        // Touch events for two-finger panning and pinch zoom
        this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
        this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        this.canvas.addEventListener('touchend', this.handleTouchEnd.bind(this));

        this.canvas.addEventListener('touchcancel', () => {
            clearTimeout(this.state.longPressTimeout); this.state.longPressTimeout = null;
            this.state.isDragging = false; this.state.isPanning = false; this.state.isDraggingDoc = false; this.state.isResizing = false; this.state.lastTapTime = 0;
        });
    }

    private handleTouchStart(e: TouchEvent): void {
        if (e.touches.length === 1) {
            this.touchMoved = false;
            e.preventDefault(); // Prevent browser scrolling/zoom

            // Start Long Press Timer
            const touch = e.touches[0];
            this.state.touchStartPosition = { x: touch.clientX, y: touch.clientY };
            this.state.longPressTimeout = setTimeout(() => {
                const mouseEvent = new MouseEvent('contextmenu', {
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    button: 2,
                    buttons: 2,
                    bubbles: true
                });
                this.handleContextMenu(mouseEvent);
                this.state.longPressTimeout = null;
            }, 500); // 500ms long press

            // One finger: Delegate to mouse logic for selection/dragging
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: touch.clientX,
                clientY: touch.clientY,
                button: 0,
                buttons: 1,
                bubbles: true
            });
            this.handleMouseDown(mouseEvent);
        } else if (e.touches.length === 2) {
            clearTimeout(this.state.longPressTimeout); // Cancel long press
            e.preventDefault();
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];

            // Calculate distance and center
            const dx = touch2.clientX - touch1.clientX;
            const dy = touch2.clientY - touch1.clientY;
            this.state.lastTouchDistance = Math.sqrt(dx * dx + dy * dy);
            this.state.lastTouchCenter = {
                x: (touch1.clientX + touch2.clientX) / 2,
                y: (touch1.clientY + touch2.clientY) / 2,
            };
            this.touchMoved = true; this.state.lastTapTime = 0;
            this.state.isDragging = false; this.state.isDraggingDoc = false; this.state.isResizing = false;
            this.state.isPanning = true;
        }
    }

    private handleTouchMove(e: TouchEvent): void {
        if (e.touches.length === 1) {
            // Check for movement to cancel long press
            const touch = e.touches[0];
            if (this.state.touchStartPosition) {
                const dx = touch.clientX - this.state.touchStartPosition.x;
                const dy = touch.clientY - this.state.touchStartPosition.y;
                if (dx * dx + dy * dy > 100) { // 10px threshold
                    this.touchMoved = true; this.state.lastTapTime = 0;
                    clearTimeout(this.state.longPressTimeout);
                    this.state.longPressTimeout = null;
                }
            }

            // One finger: Delegate to mouse logic
            e.preventDefault(); // Prevent scrolling while dragging
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY,
                button: 0,
                buttons: 1,
                bubbles: true
            });
            this.handleMouseMove(mouseEvent);
        } else if (e.touches.length === 2 && this.state.isPanning) {
            e.preventDefault();
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];

            // Calculate new distance and center
            const dx = touch2.clientX - touch1.clientX;
            const dy = touch2.clientY - touch1.clientY;
            const newDistance = Math.sqrt(dx * dx + dy * dy);
            const newCenter = {
                x: (touch1.clientX + touch2.clientX) / 2,
                y: (touch1.clientY + touch2.clientY) / 2,
            };

            // Pinch to zoom
            if (this.state.lastTouchDistance > 0) {
                const zoomFactor = newDistance / this.state.lastTouchDistance;
                const newZoom = Math.max(0.1, Math.min(5, this.state.zoom * zoomFactor));

                // Zoom towards center
                const rect = this.canvas.getBoundingClientRect();
                const centerX = newCenter.x - rect.left;
                const centerY = newCenter.y - rect.top;
                const worldBefore = this.screenToWorld(centerX, centerY);
                this.state.zoom = newZoom;
                const worldAfter = this.screenToWorld(centerX, centerY);
                this.state.pan.x += (worldAfter.x - worldBefore.x) * this.state.zoom;
                this.state.pan.y += (worldAfter.y - worldBefore.y) * this.state.zoom;
            }

            // Two-finger pan
            if (this.state.lastTouchCenter) {
                this.state.pan.x += newCenter.x - this.state.lastTouchCenter.x;
                this.state.pan.y += newCenter.y - this.state.lastTouchCenter.y;
            }

            this.state.lastTouchDistance = newDistance;
            this.state.lastTouchCenter = newCenter;
        }
    }

    private handleTouchEnd(e: TouchEvent): void {
        // Cancel long press
        if (this.state.longPressTimeout) {
            clearTimeout(this.state.longPressTimeout);
            this.state.longPressTimeout = null;
        }

        // Always propagate touch end to mouse up to finish drags/clicks
        // We use changedTouches[0] for the location if available, or just call mouseup
        if (e.changedTouches.length > 0) {
            const touch = e.changedTouches[0];
            const mouseEvent = new MouseEvent('mouseup', {
                clientX: touch.clientX,
                clientY: touch.clientY,
                button: 0,
                buttons: 0,
                bubbles: true
            });
            this.handleMouseUp(mouseEvent);

            // Detect Double Tap
            const now = Date.now();
            if (!this.touchMoved && now - this.state.lastTapTime < 300 && this.lastTapPosition && Math.hypot(touch.clientX - this.lastTapPosition.x, touch.clientY - this.lastTapPosition.y) < 24) {
                // Double Tap detected
                const dblClickEvent = new MouseEvent('dblclick', {
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    button: 0,
                    buttons: 0,
                    bubbles: true
                });
                this.handleDoubleClick(dblClickEvent);
                this.state.lastTapTime = 0; // Reset
            } else {
                this.state.lastTapTime = this.touchMoved ? 0 : now;
                this.lastTapPosition = { x: touch.clientX, y: touch.clientY };
            }
        }

        if (e.touches.length < 2) {
            this.state.isPanning = false;
            this.state.lastTouchDistance = 0;
            this.state.lastTouchCenter = null;
        }
    }

    private handleContextMenu(e: MouseEvent): void {
        e.preventDefault();

        // Only show context menu in simulation mode (menus relate to simulation actions)
        if (!this.simulationMode) return;

        const rect = this.canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldPos = this.screenToWorld(screenX, screenY);

        const node = this.findNodeAt(worldPos);
        if (node) {
            this.runtime.events.emit('node:contextmenu', {
                node,
                screenX: e.clientX,
                screenY: e.clientY,
            });
        }
    }

    public screenToWorld(screenX: number, screenY: number): Position {
        return {
            x: (screenX - this.state.pan.x) / this.state.zoom,
            y: (screenY - this.state.pan.y) / this.state.zoom,
        };
    }

    private handleMouseDown(e: MouseEvent): void {
        const rect = this.canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldPos = this.screenToWorld(screenX, screenY);

        // Middle mouse button or Space+Left-Click for panning
        if (e.button === 1 || (e.button === 0 && this.state.spacePressed)) {
            this.state.isPanning = true;
            this.state.dragOffset = { x: screenX - this.state.pan.x, y: screenY - this.state.pan.y };
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        // Right click for cable drawing
        if (e.button === 2 && !this.simulationMode) {
            const node = this.findNodeAt(worldPos);
            if (node) {
                const portIndex = this.findPortAt(node, worldPos);
                this.state.isDrawingCable = true;
                this.state.cableStartNode = node;
                this.state.cableStartPort = portIndex;
                this.state.cablePreviewEnd = worldPos;
                this.runtime.events.emit(Events.CABLE_DRAWING_START, { node, portIndex });
            }
            return;
        }

        // Left click for selection/dragging
        const clickedNode = this.findNodeAt(worldPos);
        const clickedCable = this.findCableAt(worldPos);
        const clickedDocElement = this.findDocElementAt(worldPos);

        // Check for resize handle first (only for selected rectangle/textbox)
        const resizeHit = this.findResizeHandleAt(worldPos);
        if (resizeHit) {
            this.state.isResizing = true;
            this.state.resizeHandle = 'se';
            return;
        }

        // Deselect previous
        this.deselectAll();

        // Priority: nodes > cables > doc elements (devices should be selectable through doc elements)
        if (clickedNode) {
            clickedNode.setSelected(true);
            this.state.selectedNodeId = clickedNode.getId();

            // Only enable dragging if allowed
            if (this.state.draggingEnabled) {
                this.state.isDragging = true;
                const nodePos = clickedNode.getPosition();
                this.state.dragOffset = {
                    x: worldPos.x - nodePos.x,
                    y: worldPos.y - nodePos.y,
                };
            }

            this.runtime.events.emit(Events.DEVICE_SELECTED, { device: clickedNode });
        } else if (clickedCable) {
            clickedCable.setSelected(true);
            this.state.selectedCableId = clickedCable.getId();
            this.runtime.events.emit('cable:selected', { cable: clickedCable });
        } else if (clickedDocElement && !this.simulationMode) {
            // Doc elements only if no device/cable clicked and not in simulation mode
            clickedDocElement.selected = true;
            this.state.selectedDocElementId = clickedDocElement.id;

            if (this.state.draggingEnabled) {
                this.state.isDraggingDoc = true;
                this.state.dragOffset = {
                    x: worldPos.x - clickedDocElement.position.x,
                    y: worldPos.y - clickedDocElement.position.y,
                };
            }
        } else {
            // Clicked on empty canvas - start panning
            this.state.isPanning = true;
            this.state.dragOffset = {
                x: screenX,
                y: screenY,
            };
            this.runtime.events.emit(Events.SELECTION_CLEARED, { x: screenX, y: screenY });
        }
    }

    private findDocElementAt(worldPos: Position): DocElement | null {
        // Search in reverse to find topmost element first
        for (let i = this.docElements.length - 1; i >= 0; i--) {
            const elem = this.docElements[i];
            if (elem.type === 'label') {
                // Labels are just text, give a generous hit area
                if (worldPos.x >= elem.position.x && worldPos.x <= elem.position.x + elem.width &&
                    worldPos.y >= elem.position.y && worldPos.y <= elem.position.y + elem.height) {
                    return elem;
                }
            } else {
                // Textbox and rectangle
                if (worldPos.x >= elem.position.x && worldPos.x <= elem.position.x + elem.width &&
                    worldPos.y >= elem.position.y && worldPos.y <= elem.position.y + elem.height) {
                    return elem;
                }
            }
        }
        return null;
    }

    private findResizeHandleAt(worldPos: Position): boolean {
        if (!this.state.selectedDocElementId) return false;

        const elem = this.docElements.find(e => e.id === this.state.selectedDocElementId);
        if (!elem || elem.type === 'label') return false;

        // Check southeast corner (bottom-right)
        const handleSize = 12;
        const handleX = elem.position.x + elem.width - handleSize;
        const handleY = elem.position.y + elem.height - handleSize;

        return worldPos.x >= handleX && worldPos.x <= elem.position.x + elem.width &&
            worldPos.y >= handleY && worldPos.y <= elem.position.y + elem.height;
    }

    private handleMouseMove(e: MouseEvent): void {
        const rect = this.canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldPos = this.screenToWorld(screenX, screenY);

        if (this.state.isPanning) {
            const dx = screenX - this.state.dragOffset.x;
            const dy = screenY - this.state.dragOffset.y;
            this.state.pan.x += dx;
            this.state.pan.y += dy;
            this.state.dragOffset.x = screenX;
            this.state.dragOffset.y = screenY;
            return;
        }

        // Resizing doc element
        if (this.state.isResizing && this.state.selectedDocElementId) {
            const elem = this.docElements.find(e => e.id === this.state.selectedDocElementId);
            if (elem) {
                const minSize = 40;
                elem.width = Math.max(minSize, worldPos.x - elem.position.x);
                elem.height = Math.max(minSize, worldPos.y - elem.position.y);
            }
            return;
        }

        // Doc element dragging
        if (this.state.isDraggingDoc && this.state.selectedDocElementId) {
            const elem = this.docElements.find(e => e.id === this.state.selectedDocElementId);
            if (elem) {
                elem.position.x = worldPos.x - this.state.dragOffset.x;
                elem.position.y = worldPos.y - this.state.dragOffset.y;
            }
            return;
        }

        if (this.state.isDragging && this.state.selectedNodeId) {
            const node = this.findNodeById(this.state.selectedNodeId);
            if (node) {
                node.setPosition({
                    x: worldPos.x - this.state.dragOffset.x,
                    y: worldPos.y - this.state.dragOffset.y,
                });
            }
            return;
        }

        if (this.state.isDrawingCable) {
            this.state.cablePreviewEnd = worldPos;
            return;
        }

        // Update cursor based on what's under it
        const nodeUnder = this.findNodeAt(worldPos);
        const cableUnder = this.findCableAt(worldPos);

        if (nodeUnder) {
            this.canvas.style.cursor = 'move';
        } else if (cableUnder) {
            this.canvas.style.cursor = 'pointer';
        } else {
            this.canvas.style.cursor = 'default';
        }
    }

    private handleMouseUp(e: MouseEvent): void {
        const rect = this.canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldPos = this.screenToWorld(screenX, screenY);

        if (this.state.isDrawingCable && this.state.cableStartNode) {
            const endNode = this.findNodeAt(worldPos);
            if (endNode && endNode !== this.state.cableStartNode) {
                const endPortIndex = this.findPortAt(endNode, worldPos);
                this.runtime.events.emit(Events.CABLE_DRAWING_END, {
                    startNode: this.state.cableStartNode,
                    startPort: this.state.cableStartPort,
                    endNode,
                    endPort: endPortIndex,
                });
            }
        }

        // Reset cursor if we were panning
        if (this.state.isPanning) {
            this.canvas.style.cursor = this.state.spacePressed ? 'grab' : 'default';
        }

        // Emit event if doc element was modified (dragged or resized)
        if ((this.state.isDraggingDoc || this.state.isResizing) && this.state.selectedDocElementId) {
            this.runtime.events.emit(Events.DOC_ELEMENT_CHANGED, { id: this.state.selectedDocElementId });
        }

        this.state.isDragging = false;
        this.state.isDraggingDoc = false;
        this.state.isResizing = false;
        this.state.resizeHandle = null;
        this.state.isPanning = false;
        this.state.isDrawingCable = false;
        this.state.cableStartNode = null;
        this.state.cableStartPort = 0;
        this.state.cablePreviewEnd = null;
    }

    private handleWheel(e: WheelEvent): void {
        e.preventDefault();

        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.1, Math.min(5, this.state.zoom * zoomFactor));

        // Adjust pan to zoom towards mouse position
        const worldBefore = this.screenToWorld(mouseX, mouseY);
        this.state.zoom = newZoom;
        const worldAfter = this.screenToWorld(mouseX, mouseY);

        this.state.pan.x += (worldAfter.x - worldBefore.x) * this.state.zoom;
        this.state.pan.y += (worldAfter.y - worldBefore.y) * this.state.zoom;
    }

    private async handleDoubleClick(e: MouseEvent): Promise<void> {
        const rect = this.canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldPos = this.screenToWorld(screenX, screenY);

        // Check for doc element first (for text editing) - only in design mode
        if (!this.simulationMode) {
            const docElem = this.findDocElementAt(worldPos);
            if (docElem && (docElem.type === 'textbox' || docElem.type === 'label')) {
                const newText = await askText('Text bearbeiten:', docElem.text);
                if (newText !== null) {
                    docElem.text = newText;
                }
                return;
            }
        }

        const node = this.findNodeAt(worldPos);
        if (node && this.runtime.simulation.getMode() === 'simulation') {
            this.runtime.events.emit(Events.DESKTOP_OPEN, { node });
        }
    }

    public findNodeAt(pos: Position): Knoten | null {
        // Search in reverse to get topmost first
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const node = this.nodes[i];

            // Check if point is within main node bounds
            if (node.containsPoint(pos.x, pos.y)) {
                return node;
            }

            // For routers, also check if point is on a port
            if (node.getType() === 'router') {
                const router = node as any;
                if (router.getInterfacePositions) {
                    const portPositions = router.getInterfacePositions();
                    for (const portPos of portPositions) {
                        const dx = pos.x - portPos.x;
                        const dy = pos.y - portPos.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        if (distance <= 15) { // Port click radius
                            return node;
                        }
                    }
                }
            }
        }
        return null;
    }

    private findNodeById(id: string): Knoten | null {
        return this.nodes.find(n => n.getId() === id) || null;
    }

    private findCableAt(pos: Position): Kabel | null {
        for (const cable of this.cables) {
            if (cable.containsPoint(pos.x, pos.y)) {
                return cable;
            }
        }
        return null;
    }

    // Find which router port was clicked (returns -1 for non-router or no port)
    private findPortAt(node: Knoten, pos: Position): number {
        if (node.getType() !== 'router') {
            return 0; // Non-routers use port 0
        }

        const router = node as any;
        if (!router.getInterfacePositions) return 0;

        const portPositions = router.getInterfacePositions();
        const clickRadius = 12; // How close click must be to port center

        for (const portPos of portPositions) {
            const dx = pos.x - portPos.x;
            const dy = pos.y - portPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance <= clickRadius) {
                return portPos.index;
            }
        }

        // If no specific port clicked, find nearest port
        let nearestPort = 0;
        let nearestDist = Infinity;
        for (const portPos of portPositions) {
            const dx = pos.x - portPos.x;
            const dy = pos.y - portPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < nearestDist) {
                nearestDist = distance;
                nearestPort = portPos.index;
            }
        }
        return nearestPort;
    }

    public deselectAll(): void {
        this.nodes.forEach(n => n.setSelected(false));
        this.cables.forEach(c => c.setSelected(false));
        this.docElements.forEach(e => e.selected = false);
        this.state.selectedNodeId = null;
        this.state.selectedCableId = null;
        this.state.selectedDocElementId = null;
    }

    // Public API
    getCanvasElement(): HTMLCanvasElement { return this.canvas; }
    addNode(node: Knoten): void {
        this.nodes.push(node);
        this.runtime.events.emit(Events.DEVICE_ADDED, { device: node });
    }

    removeNode(nodeId: string): void {
        const index = this.nodes.findIndex(n => n.getId() === nodeId);
        if (index !== -1) {
            const node = this.nodes[index];
            // Remove connected cables
            this.cables = this.cables.filter(c => { if (!c.isConnectedTo(nodeId)) return true; c.disconnect(); return false; });
            this.nodes.splice(index, 1);
            this.runtime.events.emit(Events.DEVICE_REMOVED, { device: node });
        }
    }

    addCable(cable: Kabel): void {
        this.cables.push(cable);
        this.runtime.events.emit(Events.CABLE_ADDED, { cable });
    }

    removeCable(cableId: string): void {
        const index = this.cables.findIndex(c => c.getId() === cableId);
        if (index !== -1) {
            const cable = this.cables[index];
            cable.disconnect();
            this.cables.splice(index, 1);
            this.runtime.events.emit(Events.CABLE_REMOVED, { cable });
        }
    }

    getNodes(): Knoten[] {
        return [...this.nodes];
    }

    getCables(): Kabel[] {
        return [...this.cables];
    }

    getSelectedNode(): Knoten | null {
        return this.state.selectedNodeId ? this.findNodeById(this.state.selectedNodeId) : null;
    }

    clear(preserved = new Set<Knoten>()): void {
        this.nodes.forEach(node => { if (node instanceof Modem && !preserved.has(node)) node.disconnect(); });
        this.cables.forEach(cable => cable.disconnect());
        this.nodes = [];
        this.cables = [];
        this.deselectAll();
    }

    setNodes(nodes: Knoten[]): void {
        this.nodes = nodes;
    }

    setCables(cables: Kabel[]): void {
        this.cables = cables;
    }

    // Rendering
    private startRenderLoop(): void {
        const render = () => {
            this.render();
            this.animationFrameId = requestAnimationFrame(render);
        };
        render();
    }

    private render(): void {
        const { ctx, canvas } = this;

        // Clear
        ctx.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--bg-canvas').trim() || '#0a0f1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Apply transform
        ctx.save();
        ctx.translate(this.state.pan.x, this.state.pan.y);
        ctx.scale(this.state.zoom, this.state.zoom);

        // Draw grid
        this.drawGrid();

        // Draw cables
        this.cables.forEach(cable => this.drawCable(cable));

        // Draw cable preview
        if (this.state.isDrawingCable && this.state.cableStartNode && this.state.cablePreviewEnd) {
            const startPos = this.state.cableStartNode.getPosition();
            ctx.beginPath();
            ctx.moveTo(startPos.x, startPos.y);
            ctx.lineTo(this.state.cablePreviewEnd.x, this.state.cablePreviewEnd.y);
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw documentation elements (before nodes, so nodes appear on top)
        this.docElements.forEach(elem => {
            if (elem.type === 'rectangle') {
                ctx.fillStyle = elem.color || 'rgba(37, 99, 235, 0.15)';
                ctx.strokeStyle = elem.selected ? '#3b82f6' : 'rgba(37, 99, 235, 0.4)';
                ctx.lineWidth = elem.selected ? 2 : 1;
                ctx.fillRect(elem.position.x, elem.position.y, elem.width, elem.height);
                ctx.strokeRect(elem.position.x, elem.position.y, elem.width, elem.height);

                // Draw resize handle if selected
                if (elem.selected) {
                    const handleSize = 10;
                    ctx.fillStyle = '#3b82f6';
                    ctx.fillRect(
                        elem.position.x + elem.width - handleSize,
                        elem.position.y + elem.height - handleSize,
                        handleSize,
                        handleSize
                    );
                }
            } else if (elem.type === 'textbox') {
                ctx.fillStyle = 'rgba(248, 250, 252, 0.95)';
                ctx.strokeStyle = elem.selected ? '#3b82f6' : '#cbd5e1';
                ctx.lineWidth = elem.selected ? 2 : 1;
                ctx.fillRect(elem.position.x, elem.position.y, elem.width, elem.height);
                ctx.strokeRect(elem.position.x, elem.position.y, elem.width, elem.height);
                ctx.fillStyle = '#1e293b';
                ctx.font = '12px Inter, -apple-system, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                this.wrapTextLive(ctx, elem.text, elem.position.x + 8, elem.position.y + 8, elem.width - 16, 16);

                // Draw resize handle if selected
                if (elem.selected) {
                    const handleSize = 10;
                    ctx.fillStyle = '#3b82f6';
                    ctx.fillRect(
                        elem.position.x + elem.width - handleSize,
                        elem.position.y + elem.height - handleSize,
                        handleSize,
                        handleSize
                    );
                }
            } else if (elem.type === 'label') {
                ctx.fillStyle = '#f1f5f9';
                ctx.font = 'bold 14px Inter, -apple-system, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(elem.text, elem.position.x, elem.position.y);
            }
        });

        // Draw nodes
        this.nodes.forEach(node => this.drawNode(node));

        ctx.restore();
    }

    private wrapTextLive(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
        const words = text.split(' ');
        let line = '';

        for (let i = 0; i < words.length; i++) {
            const testLine = line + words[i] + ' ';
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && i > 0) {
                ctx.fillText(line.trim(), x, y);
                line = words[i] + ' ';
                y += lineHeight;
            } else {
                line = testLine;
            }
        }
        ctx.fillText(line.trim(), x, y);
    }

    private drawGrid(): void {
        const { ctx, canvas } = this;
        const gridSize = 40;

        ctx.strokeStyle = 'rgba(51, 65, 85, 0.3)';
        ctx.lineWidth = 1 / this.state.zoom;

        const startX = Math.floor(-this.state.pan.x / this.state.zoom / gridSize) * gridSize;
        const startY = Math.floor(-this.state.pan.y / this.state.zoom / gridSize) * gridSize;
        const endX = startX + canvas.clientWidth / this.state.zoom + gridSize;
        const endY = startY + canvas.clientHeight / this.state.zoom + gridSize;

        ctx.beginPath();
        for (let x = startX; x <= endX; x += gridSize) {
            ctx.moveTo(x, startY);
            ctx.lineTo(x, endY);
        }
        for (let y = startY; y <= endY; y += gridSize) {
            ctx.moveTo(startX, y);
            ctx.lineTo(endX, y);
        }
        ctx.stroke();
    }

    private drawCable(cable: Kabel): void {
        const positions = cable.getPositions();
        if (!positions) return;

        const { ctx } = this;
        const { start, end } = positions;

        // Determine cable color
        let strokeColor = '#475569'; // Default gray
        let lineWidth = 3;

        if (cable.isFlashing()) {
            strokeColor = cable.getFlashColor();
            lineWidth = 5;
        } else if (cable.isSelected()) {
            strokeColor = '#3b82f6'; // Blue selected
            lineWidth = 4;
        }

        // Draw cable line
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.setLineDash(cable.isWireless()?[8,8]:[]);ctx.stroke();ctx.setLineDash([]);

        // Draw packet animations
        const packets = cable.getActivePackets();
        packets.forEach(packet => {
            const progress = packet.direction === 1 ? packet.progress : 1 - packet.progress;
            const x = start.x + (end.x - start.x) * progress;
            const y = start.y + (end.y - start.y) * progress;

            // Use packet color
            ctx.fillStyle = packet.color || '#3b82f6';
            ctx.shadowColor = packet.color || '#3b82f6';
            ctx.shadowBlur = 10;

            const isBroadcast = packet.isBroadcast;

            ctx.beginPath();
            if (isBroadcast) {
                // Draw Square for Broadcast
                ctx.rect(x - 5, y - 5, 10, 10);
            } else {
                // Draw Circle for Unicast
                ctx.arc(x, y, 6, 0, Math.PI * 2);
            }

            ctx.fill();
            ctx.shadowBlur = 0;
        });
    }

    private drawNode(node: Knoten): void {
        const { ctx } = this;
        const pos = node.getPosition();
        const bounds = node.getBounds();
        const size = 60;

        // Get image based on node type
        const img = this.images.get(deviceIconName(node, this.nodes));

        // Draw selection highlight
        if (node.isSelected()) {
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 3;
            ctx.strokeRect(bounds.x - 4, bounds.y - 4, bounds.width + 8, bounds.height + 8);
        }

        // Draw image or placeholder
        if (img && img.complete) {
            ctx.drawImage(img, bounds.x, bounds.y, size, size);
        } else {
            // Placeholder
            ctx.fillStyle = '#334155';
            ctx.fillRect(bounds.x, bounds.y, size, size);
            ctx.fillStyle = '#94a3b8';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(node.getType(), pos.x, pos.y);
        }

        // Draw label
        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(node.getName(), pos.x, bounds.y + size + 16);

        // Draw router interface ports
        if (node.getType() === 'router') {
            this.drawRouterPorts(node as any);
        }
    }

    private drawRouterPorts(router: any): void {
        if (!router.getInterfacePositions) return;

        const { ctx } = this;
        const positions = router.getInterfacePositions();

        positions.forEach((portPos: any, i: number) => {
            const isConnected = this.isPortConnected(router, i);

            // Port circle
            ctx.beginPath();
            ctx.arc(portPos.x, portPos.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = isConnected ? '#22c55e' : '#475569';
            ctx.fill();
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Port number label
            ctx.fillStyle = '#94a3b8';
            ctx.font = '9px sans-serif';
            ctx.textAlign = portPos.side === 'left' ? 'right' : 'left';
            const labelX = portPos.side === 'left' ? portPos.x - 10 : portPos.x + 10;
            ctx.fillText(`${i + 1}`, labelX, portPos.y + 3);
        });
    }

    private isPortConnected(_router: any, _portIndex: number): boolean {
        // Check if any cable is connected to this specific router port
        return this.cables.some(cable => {
            const ep1 = cable.getEndpoint1();
            const ep2 = cable.getEndpoint2();

            // Check if endpoint 1 is this router at this port
            if (ep1 !== null && ep1.node === _router && ep1.portIndex === _portIndex) {
                return true;
            }
            // Check if endpoint 2 is this router at this port
            if (ep2 !== null && ep2.node === _router && ep2.portIndex === _portIndex) {
                return true;
            }
            return false;
        });
    }

    // --- Documentation Features ---

    exportAsPNG(filename: string): void {
        // Create a temporary canvas with white background
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.canvas.width;
        tempCanvas.height = this.canvas.height;
        const tempCtx = tempCanvas.getContext('2d');

        if (!tempCtx) return;

        // Fill with white background
        tempCtx.fillStyle = '#ffffff';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        // Copy current canvas content
        tempCtx.drawImage(this.canvas, 0, 0);

        // Download as PNG
        const link = document.createElement('a');
        link.download = filename;
        link.href = tempCanvas.toDataURL('image/png');
        link.click();
    }

    // --- Full Documentation Mode ---

    async addDocElement(type: 'textbox' | 'label' | 'rectangle', position: Position): Promise<void> {
        const defaultText = type === 'rectangle' ? '' : (type === 'label' ? 'Label' : 'Beschreibung hier eingeben...');
        const element: DocElement = {
            id: `doc-${Date.now()}`,
            type,
            position,
            text: defaultText,
            width: type === 'textbox' ? 200 : (type === 'label' ? 100 : 150),
            height: type === 'textbox' ? 80 : (type === 'label' ? 30 : 100),
            color: type === 'rectangle' ? 'rgba(37, 99, 235, 0.2)' : '#e2e8f0',
            selected: false,
        };
        // Prompt for text if textbox or label
        if (type === 'textbox' || type === 'label') {
            const text = await askText(`${type === 'textbox' ? 'Textfeld' : 'Label'}-Text eingeben:`, defaultText);
            if (text === null) return;
            element.text = text;
        }

        this.docElements.push(element);
        this.runtime.events.emit(Events.DOC_ELEMENT_CHANGED, { element });
    }

    removeDocElement(id: string): void {
        this.docElements = this.docElements.filter(e => e.id !== id);
        this.runtime.events.emit(Events.DOC_ELEMENT_CHANGED, { id });
    }

    getDocElements(): DocElement[] {
        return this.docElements;
    }

    setDocElements(elements: DocElement[]): void {
        this.docElements = elements;
    }

    clearDocElements(): void {
        this.docElements = [];
    }

    exportFullNetworkAsPNG(filename: string): void {
        // Calculate bounding box of all elements
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        // Include nodes
        this.nodes.forEach(node => {
            const pos = node.getPosition();
            minX = Math.min(minX, pos.x - 40);
            minY = Math.min(minY, pos.y - 40);
            maxX = Math.max(maxX, pos.x + 40);
            maxY = Math.max(maxY, pos.y + 60);
        });

        // Include doc elements
        this.docElements.forEach(elem => {
            minX = Math.min(minX, elem.position.x);
            minY = Math.min(minY, elem.position.y);
            maxX = Math.max(maxX, elem.position.x + elem.width);
            maxY = Math.max(maxY, elem.position.y + elem.height);
        });

        // Handle empty canvas
        if (minX === Infinity) {
            minX = 0; minY = 0; maxX = 800; maxY = 600;
        }

        // Add padding
        const padding = 50;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        const width = maxX - minX;
        const height = maxY - minY;

        // Create export canvas
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = width;
        exportCanvas.height = height;
        const ctx = exportCanvas.getContext('2d');

        if (!ctx) return;

        // White background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        // Translate to origin
        ctx.translate(-minX, -minY);

        // Draw cables
        this.cables.forEach(cable => {
            const ep1 = cable.getEndpoint1();
            const ep2 = cable.getEndpoint2();
            if (ep1 && ep2) {
                const pos1 = ep1.node.getPosition();
                const pos2 = ep2.node.getPosition();
                ctx.beginPath();
                ctx.moveTo(pos1.x, pos1.y);
                ctx.lineTo(pos2.x, pos2.y);
                ctx.strokeStyle = '#666666';
                ctx.lineWidth = 3;
                ctx.stroke();
            }
        });

        // Draw doc elements
        this.docElements.forEach(elem => {
            if (elem.type === 'rectangle') {
                ctx.fillStyle = elem.color;
                ctx.strokeStyle = 'rgba(37, 99, 235, 0.5)';
                ctx.lineWidth = 2;
                ctx.fillRect(elem.position.x, elem.position.y, elem.width, elem.height);
                ctx.strokeRect(elem.position.x, elem.position.y, elem.width, elem.height);
            } else if (elem.type === 'textbox') {
                ctx.fillStyle = '#f8fafc';
                ctx.strokeStyle = '#cbd5e1';
                ctx.lineWidth = 1;
                ctx.fillRect(elem.position.x, elem.position.y, elem.width, elem.height);
                ctx.strokeRect(elem.position.x, elem.position.y, elem.width, elem.height);
                ctx.fillStyle = '#1e293b';
                ctx.font = '12px Inter, sans-serif';
                this.wrapText(ctx, elem.text, elem.position.x + 8, elem.position.y + 18, elem.width - 16, 16);
            } else if (elem.type === 'label') {
                ctx.fillStyle = '#1e293b';
                ctx.font = 'bold 14px Inter, sans-serif';
                ctx.fillText(elem.text, elem.position.x, elem.position.y + 20);
            }
        });

        // Draw nodes with actual images
        this.nodes.forEach(node => {
            const pos = node.getPosition();

            // Use the same configured-device symbol as the live canvas.
            const img = this.images.get(deviceIconName(node, this.nodes));
            const imgSize = 48;

            // Draw circle background
            ctx.fillStyle = '#e2e8f0';
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 30, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Draw image if loaded, otherwise fallback to text
            if (img && img.complete) {
                ctx.drawImage(img, pos.x - imgSize / 2, pos.y - imgSize / 2, imgSize, imgSize);
            } else {
                // Fallback to text
                ctx.fillStyle = '#475569';
                ctx.font = 'bold 14px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(node.getType().toUpperCase(), pos.x, pos.y);
            }

            // Draw name
            ctx.fillStyle = '#1e293b';
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(node.getName(), pos.x, pos.y + 35);
        });

        // Download
        const link = document.createElement('a');
        link.download = filename;
        link.href = exportCanvas.toDataURL('image/png');
        link.click();
    }

    private wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
        const words = text.split(' ');
        let line = '';
        let testLine = '';

        for (let i = 0; i < words.length; i++) {
            testLine = line + words[i] + ' ';
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && i > 0) {
                ctx.fillText(line, x, y);
                line = words[i] + ' ';
                y += lineHeight;
            } else {
                line = testLine;
            }
        }
        ctx.fillText(line, x, y);
    }

    destroy(): void {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        this.listenerController.abort(); this.resizeObserver.disconnect();
        clearTimeout(this.state.longPressTimeout);
        this.canvas.remove();
    }
}
