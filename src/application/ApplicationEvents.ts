import type { EventBus, EventCallback } from '../core/EventBus';
import type { Host, Knoten, Kabel } from '../hardware';
export interface ServiceChange {
    type?: string;
    hostId?: string;
    host?: Host;
}
/** UI-facing event contracts; transport events remain with the protocol runtime. */
export interface ApplicationEventMap {
    'device:added': {
        device: Knoten;
    };
    'device:removed': {
        device: Knoten;
        id?: string;
    };
    'device:selected': {
        device: Knoten;
    };
    'device:moved': {
        device: Knoten;
    };
    'device:config-changed': {
        device: Knoten;
    };
    'doc-element:changed': object;
    'selection:cleared': {
        x?: number;
        y?: number;
    };
    'cable:added': {
        cable: Kabel;
    };
    'cable:removed': {
        cable?: Kabel;
        id?: string;
    };
    'cable:selected': {
        cable: Kabel;
    };
    'cable:drawing-end': {
        startNode: Knoten;
        startPort: number;
        endNode: Knoten;
        endPort: number;
    };
    'desktop:open': {
        node: Knoten;
    };
    'desktop:close': {
        host: Host;
    };
    'app:launch': {
        host: Host;
        appId: string;
    };
    'service:state-changed': ServiceChange;
    'node:contextmenu': {
        node: Knoten;
        screenX: number;
        screenY: number;
    };
    'modem:log': {
        id: string;
        log: string;
    };
}
export class ApplicationEvents {
    constructor(private bus: EventBus) { }
    listenerCount(): number { return this.bus.listenerCount(); }
    on<K extends keyof ApplicationEventMap>(event: K, callback: EventCallback<ApplicationEventMap[K]>) { return this.bus.on(event, callback); }
    off<K extends keyof ApplicationEventMap>(event: K, callback: EventCallback<ApplicationEventMap[K]>): void { this.bus.off(event, callback); }
    emit<K extends keyof ApplicationEventMap>(event: K, data: ApplicationEventMap[K]): void { this.bus.emit(event, data); }
}
