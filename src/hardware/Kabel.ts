import { legacyRuntime } from '../runtime/LegacyRuntime';
import type { RuntimeDependencies } from '../runtime/RuntimeDependencies';
import { Position } from '../core/types';
import { NetzwerkInterface } from './NetzwerkInterface';
import { Knoten } from './Knoten';
import { Events } from '../core/EventBus';
import { NetworkPacket } from '../simulation/NetworkPacket';

export interface KabelEndpoint {
    node: Knoten;
    portIndex: number;
    interface: NetzwerkInterface;
}

export interface KabelConfig {
    id?: string;
    wireless?: boolean;
    endpoint1: { nodeId: string; portIndex: number };
    endpoint2: { nodeId: string; portIndex: number };
}

interface TransitPacket {
    packet: NetworkPacket;
    progress: number; // 0 to 100
    fromEndpoint: 1 | 2; // Direction
}

export class Kabel {
    private id: string;
    private wireless=false;
    isWireless():boolean{return this.wireless;}
    setWireless(wireless:boolean):void{this.wireless=wireless;}
    private endpoint1: KabelEndpoint | null = null;
    private endpoint2: KabelEndpoint | null = null;
    private selected: boolean = false;
    private flashing: boolean = false;
    private flashColor: string = '#22c55e'; // Legacy color support

    // Physics Config
    // 0.25s traversal at 60FPS baseline (approx).
    // At 100% speed (mult=1), covers in 15 ticks.
    private readonly BASE_TICKS = 15;

    // State
    private transitPackets: TransitPacket[] = [];

    constructor(id?: string, readonly runtime: RuntimeDependencies = legacyRuntime) {
        this.id = id || this.runtime.ids.generateId();
    }

    clearTransit(): void { this.transitPackets = []; }

    getId(): string {
        return this.id;
    }

    /**
     * Simulation Tick
     * @param speedMultiplier Global speed factor
     */
    tick(speedMultiplier: number): void {
        this.processTransit(speedMultiplier);
        this.checkInputs();
    }

    private processTransit(speedMultiplier: number): void {
        const increment = (100 / this.BASE_TICKS) * speedMultiplier;

        for (let i = this.transitPackets.length - 1; i >= 0; i--) {
            const item = this.transitPackets[i];
            item.progress += increment;
            item.packet.progress = item.progress;

            if (item.progress >= 100) {
                this.deliver(item);
                this.transitPackets.splice(i, 1);
            }
        }
    }

    private deliver(item: TransitPacket): void {
        const dest = item.fromEndpoint === 1 ? this.endpoint2 : this.endpoint1;
        if (dest && dest.interface) {
            dest.interface.receivePacket(item.packet);
        }
    }

    private checkInputs(): void {
        if (!this.endpoint1 || !this.endpoint2) return;

        if (this.endpoint1.interface.hasPendingPackets()) {
            const p = this.endpoint1.interface.popPendingPacket();
            if (p) this.transitPackets.push({ packet: p, progress: 0, fromEndpoint: 1 });
        }

        if (this.endpoint2.interface.hasPendingPackets()) {
            const p = this.endpoint2.interface.popPendingPacket();
            if (p) this.transitPackets.push({ packet: p, progress: 0, fromEndpoint: 2 });
        }
    }

    // Accessor for Visualization Layer
    getTransitPackets(): { packet: NetworkPacket; progress: number; fromEndpoint: 1 | 2 }[] {
        return this.transitPackets;
    }

    // Flash briefly with a specific color
    flash(color: string = '#22c55e', duration: number = 200): void {
        this.flashing = true;
        this.flashColor = color;
        setTimeout(() => {
            this.flashing = false;
        }, duration);
    }

    // Legacy support
    flashGreen(): void {
        this.flash('#22c55e');
    }

    isFlashing(): boolean {
        return this.flashing;
    }

    getFlashColor(): string {
        return this.flashColor;
    }

    connect(endpoint: KabelEndpoint, isFirst: boolean): boolean {
        if (endpoint.node.runtime !== this.runtime || endpoint.interface.runtime !== this.runtime) throw new Error('Geräte und Kabel gehören zu unterschiedlichen Projekten');
        const current = isFirst ? this.endpoint1 : this.endpoint2;
        if (endpoint.interface.isConnected() && endpoint.interface !== current?.interface) throw new Error('Anschluss bereits verbunden');
        const other = isFirst ? this.endpoint2 : this.endpoint1;
        if (other?.node === endpoint.node) throw new Error('Ein Gerät kann nicht mit sich selbst verbunden werden');
        if (isFirst) {
            if (this.endpoint1) {
                this.endpoint1.interface.disconnect();
            }
            this.endpoint1 = endpoint;
        } else {
            if (this.endpoint2) {
                this.endpoint2.interface.disconnect();
            }
            this.endpoint2 = endpoint;
        }

        // If both endpoints are set, establish connection
        if (this.endpoint1 && this.endpoint2) {
            this.endpoint1.interface.connect(this.endpoint2.interface);
            this.endpoint2.interface.connect(this.endpoint1.interface);
            this.runtime.events.emit(Events.CABLE_ADDED, { cable: this });
            return true;
        }

        return false;
    }

    disconnect(): void {
        this.clearTransit();
        this.endpoint1?.interface.clearQueue();
        this.endpoint2?.interface.clearQueue();
        if (this.endpoint1) {
            this.endpoint1.interface.disconnect();
        }
        if (this.endpoint2) {
            this.endpoint2.interface.disconnect();
        }
        this.runtime.events.emit(Events.CABLE_REMOVED, { cable: this });
    }

    getEndpoint1(): KabelEndpoint | null {
        return this.endpoint1;
    }

    getEndpoint2(): KabelEndpoint | null {
        return this.endpoint2;
    }

    getEndpoints(): { node1: Knoten | null; node2: Knoten | null } {
        return {
            node1: this.endpoint1?.node || null,
            node2: this.endpoint2?.node || null,
        };
    }

    getOtherEndpoint(nodeId: string): KabelEndpoint | null {
        if (this.endpoint1?.node.getId() === nodeId) {
            return this.endpoint2;
        }
        if (this.endpoint2?.node.getId() === nodeId) {
            return this.endpoint1;
        }
        return null;
    }

    isConnectedTo(nodeId: string): boolean {
        return this.endpoint1?.node.getId() === nodeId ||
            this.endpoint2?.node.getId() === nodeId;
    }

    isFullyConnected(): boolean {
        return this.endpoint1 !== null && this.endpoint2 !== null;
    }

    isSelected(): boolean {
        return this.selected;
    }

    setSelected(selected: boolean): void {
        this.selected = selected;
    }

    // Get positions for drawing
    getPositions(): { start: Position; end: Position } | null {
        if (!this.endpoint1 || !this.endpoint2) {
            return null;
        }

        return {
            start: this.endpoint1.node.getPosition(),
            end: this.endpoint2.node.getPosition(),
        };
    }

    // Check if a point is near the cable line
    containsPoint(x: number, y: number, threshold: number = 10): boolean {
        const positions = this.getPositions();
        if (!positions) return false;

        const { start, end } = positions;

        // Calculate distance from point to line segment
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;

        if (lengthSquared === 0) {
            // Start and end are the same point
            const dist = Math.sqrt((x - start.x) ** 2 + (y - start.y) ** 2);
            return dist <= threshold;
        }

        // Project point onto line
        let t = ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared;
        t = Math.max(0, Math.min(1, t));

        const projX = start.x + t * dx;
        const projY = start.y + t * dy;

        const dist = Math.sqrt((x - projX) ** 2 + (y - projY) ** 2);
        return dist <= threshold;
    }

    // Packet animation support (Legacy UI Compatibility)
    getActivePackets(): { progress: number; direction: 1 | -1; color: string; isBroadcast: boolean }[] {
        return this.transitPackets.map(item => ({
            progress: item.progress / 100, // UI expects 0-1 float
            direction: item.fromEndpoint === 1 ? 1 : -1,
            color: item.packet.sourceColor || '#22c55e', // Fallback color
            isBroadcast: item.packet.destMac?.toLowerCase() === 'ff:ff:ff:ff:ff:ff'
        }));
    }

    // Serialization
    toJSON(): KabelConfig | null {
        if (!this.endpoint1 || !this.endpoint2) {
            return null;
        }

        return {
            id: this.id,
            wireless:this.wireless,
            endpoint1: {
                nodeId: this.endpoint1.node.getId(),
                portIndex: this.endpoint1.portIndex,
            },
            endpoint2: {
                nodeId: this.endpoint2.node.getId(),
                portIndex: this.endpoint2.portIndex,
            },
        };
    }
}

export function createKabel(runtime: RuntimeDependencies = legacyRuntime): Kabel {
    return new Kabel(undefined, runtime);
}
