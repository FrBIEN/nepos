// EventBus - Central event system for simulation and UI communication

export type EventCallback<T = unknown> = (data: T) => void;

interface EventSubscription {
    unsubscribe: () => void;
}

export class EventBus {
    private listeners: Map<string, Set<EventCallback<unknown>>> = new Map();

    listenerCount(event?:string):number {return event===undefined?[...this.listeners.values()].reduce((sum,listeners)=>sum+listeners.size,0):this.listeners.get(event)?.size??0;}

    clear(): void { this.listeners.clear(); }

    on<T>(event: string, callback: EventCallback<T>): EventSubscription {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(callback as EventCallback<unknown>);

        return {
            unsubscribe: () => {
                this.listeners.get(event)?.delete(callback as EventCallback<unknown>);
            }
        };
    }

    off<T>(event: string, callback: EventCallback<T>): void {
        this.listeners.get(event)?.delete(callback as EventCallback<unknown>);
    }

    emit<T>(event: string, data: T): void {
        this.listeners.get(event)?.forEach(callback => {
            try {
                callback(data);
            } catch (err) {
                console.error(`Error in event handler for ${event}:`, err);
            }
        });
    }

    once<T>(event: string, callback: EventCallback<T>): EventSubscription {
        const wrapper: EventCallback<T> = (data) => {
            this.off(event, wrapper);
            callback(data);
        };
        return this.on(event, wrapper);
    }
}

// Singleton instance
export const eventBus = new EventBus();

// Event types for type safety
export const Events = {
    // Simulation events
    SIMULATION_START: 'simulation:start',
    SIMULATION_STOP: 'simulation:stop',
    SIMULATION_PAUSE: 'simulation:pause',
    SIMULATION_TICK: 'simulation:tick',

    // Mode events
    MODE_CHANGE: 'mode:change',

    // Device events
    DEVICE_ADDED: 'device:added',
    DEVICE_REMOVED: 'device:removed',
    DEVICE_SELECTED: 'device:selected',
    DEVICE_MOVED: 'device:moved',
    DEVICE_CONFIG_CHANGED: 'device:config-changed',
    DOC_ELEMENT_CHANGED: 'doc-element:changed',
    SELECTION_CLEARED: 'selection:cleared',

    // Cable events
    CABLE_ADDED: 'cable:added',
    CABLE_REMOVED: 'cable:removed',
    CABLE_DRAWING_START: 'cable:drawing-start',
    CABLE_DRAWING_END: 'cable:drawing-end',

    // Network events
    TOPOLOGY_UPDATE: 'network:topology-update',

    // Packet events
    PACKET_SENT: 'packet:sent',
    PACKET_RECEIVED: 'packet:received',
    PACKET_DROPPED: 'packet:dropped',

    // Scenario events
    SCENARIO_NEW: 'scenario:new',
    SCENARIO_LOADED: 'scenario:loaded',
    SCENARIO_SAVED: 'scenario:saved',

    // Desktop events
    DESKTOP_OPEN: 'desktop:open',
    DESKTOP_CLOSE: 'desktop:close',
    APP_LAUNCH: 'app:launch',
    APP_CLOSE: 'app:close',

    // Service state events (for persistence)
    SERVICE_STATE_CHANGED: 'service:state-changed',
} as const;
