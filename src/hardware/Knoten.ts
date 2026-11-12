import { legacyRuntime } from '../runtime/LegacyRuntime';
import type { RuntimeDependencies } from '../runtime/RuntimeDependencies';
// Knoten - Base class for all network nodes

import { Position } from '../core/types';
import { Events } from '../core/EventBus';

export type KnotenType = 'rechner' | 'notebook' | 'switch' | 'router' | 'gateway' | 'modem';

export interface KnotenConfig {
    id?: string;
    name?: string;
    type: KnotenType;
    position?: Position;
}

export abstract class Knoten {
    protected id: string;
    protected name: string;
    protected type: KnotenType;
    protected position: Position;
    protected selected: boolean = false;

    constructor(config: KnotenConfig, readonly runtime: RuntimeDependencies = legacyRuntime) {
        this.id = config.id || this.runtime.ids.generateId();
        this.type = config.type; // Set type FIRST
        this.position = config.position || { x: 100, y: 100 };
        this.name = config.name || this.getDefaultName(); // Now type is available
    }

    protected abstract getDefaultName(): string;

    // Abstract methods that subclasses must implement
    abstract getPortCount(): number;
    abstract getIconPath(): string;

    // Packet Handling (Optional override, base does nothing or delegating)
    // Default: hosts are handled by NetworkStack OS logic.
    // Switches/Routers override this.
    receivePacket(_packet: any, _portIndex: number): void {
        // Base implementation: Do nothing
        // NetworkStack will handle "Host" logic via events.
        // Switches/Routers should override.
    }

    // Getters
    getId(): string {
        return this.id;
    }

    getName(): string {
        return this.name;
    }

    setName(name: string): void {
        this.name = name;
        this.runtime.events.emit(Events.DEVICE_CONFIG_CHANGED, { id: this.id, type: 'name', value: name });
    }

    getType(): KnotenType {
        return this.type;
    }

    getPosition(): Position {
        return { ...this.position };
    }

    setPosition(pos: Position): void {
        this.position = { ...pos };
        this.runtime.events.emit(Events.DEVICE_MOVED, { id: this.id, position: this.position });
    }

    isSelected(): boolean {
        return this.selected;
    }

    setSelected(selected: boolean): void {
        this.selected = selected;
        if (selected) {
            this.runtime.events.emit(Events.DEVICE_SELECTED, { id: this.id });
        }
    }

    // For rendering
    getBounds(): { x: number; y: number; width: number; height: number } {
        const size = 60; // Default icon size
        return {
            x: this.position.x - size / 2,
            y: this.position.y - size / 2,
            width: size,
            height: size,
        };
    }

    containsPoint(x: number, y: number): boolean {
        const bounds = this.getBounds();
        return x >= bounds.x && x <= bounds.x + bounds.width &&
            y >= bounds.y && y <= bounds.y + bounds.height;
    }

    // Serialization
    abstract toJSON(): object;
}
