import { legacyRuntime } from '../runtime/LegacyRuntime';
import type { RuntimeDependencies } from '../runtime/RuntimeDependencies';
// Switch - Layer 2 switch with MAC address table

import { Events } from '../core/EventBus';

import { Knoten, KnotenConfig } from './Knoten';
import { NetzwerkInterface, NetzwerkInterfaceConfig } from './NetzwerkInterface';
import { i18n } from '../i18n';
import { NetworkPacket, clonePacket } from '../simulation/NetworkPacket';

interface MACTableEntry {
    mac: string;
    port: number;
    timestamp: number;
}

export interface SwitchConfig extends KnotenConfig {
    type: 'switch';
    portCount?: number;
    ssid?: string;
    ports?: NetzwerkInterfaceConfig[];
}

export class Switch extends Knoten {
    private ssid:string;
    private seen=new Map<string,number>();
    getSSID():string{return this.ssid;}
    setSSID(ssid:string):void{if(!ssid.trim()||new TextEncoder().encode(ssid).length>32||ssid.includes('\0'))throw new Error('SSID: 1–32 Bytes erforderlich');this.ssid=ssid;this.runtime.events.emit(Events.DEVICE_CONFIG_CHANGED,{device:this});}
    private ports: NetzwerkInterface[];
    private macTable: Map<string, MACTableEntry> = new Map();
    private readonly macTableTimeout = 300000; // 5 minutes in ms

    constructor(config: SwitchConfig, runtime: RuntimeDependencies = legacyRuntime) {
        super(config, runtime);
        this.ssid=config.ssid || `Nepos-${this.getId()}`;
        const portCount = config.portCount || 8;
        this.ports = [];

        for (let i = 0; i < portCount; i++) {
            const portConfig = config.ports?.[i] || {};
            this.ports.push(new NetzwerkInterface(portConfig, this.runtime));
        }
    }

    protected getDefaultName(): string {
        const counter = this.runtime.ids.nextName('switch');
        return `${i18n.t('devices.switch')} ${counter}`;
    }

    static resetNameCounter(): void {
        legacyRuntime.ids.resetNames('switch');
    }

    getPortCount(): number {
        return this.ports.length;
    }

    getIconPath(): string {
        return 'icons/switch.svg';
    }

    getPort(index: number): NetzwerkInterface | null {
        return this.ports[index] || null;
    }

    getPorts(): NetzwerkInterface[] {
        return [...this.ports];
    }

    /**
     * Switch Packet Processing
     * Realism:
     * 1. Learn Source MAC
     * 2. Lookup Dest MAC
     * 3. Forward or Flood
     */
    receivePacket(packet: any, portIndex: number): void {
        const p = packet as NetworkPacket;
        const now=this.runtime.simulation.getSimulationTime(),id=p.frameId||p.id;
        if((this.seen.get(id)||0)>now)return;
        this.seen.set(id,now+30000);
        if(this.seen.size>10000)for(const [key,expires] of this.seen){if(expires<=now||this.seen.size>10000)this.seen.delete(key);else break;}

        // 1. Learn Source (Mac Table)
        this.learnMAC(p.sourceMac, portIndex);

        // 2. Lookup Destination
        // If Broadcast or Unknown Unicast -> Flood
        const isBroadcast = p.destMac.toLowerCase() === 'ff:ff:ff:ff:ff:ff';
        const targetPort = isBroadcast ? null : this.lookupMAC(p.destMac);

        if (targetPort !== null && targetPort !== undefined) {
            // Unicast Known: Forward to specific port
            if (targetPort !== portIndex) { // Don't send back to source
                this.ports[targetPort].sendPacket(p);
            }
        } else {
            // Flood (Broadcast or Unknown)
            // Clone and send to all ports EXCEPT source
            this.ports.forEach((port, idx) => {
                if (idx !== portIndex && port.isConnected()) {
                    const clone = clonePacket(p);
                    port.sendPacket(clone);
                }
            });
        }
    }

    // MAC address table management
    learnMAC(mac: string, port: number): void {
        this.macTable.set(mac.toUpperCase(), {
            mac: mac.toUpperCase(),
            port,
            timestamp: this.runtime.simulation.getSimulationTime(),
        });
    }

    lookupMAC(mac: string): number | null {
        const entry = this.macTable.get(mac.toUpperCase());
        if (!entry) return null;

        // Check for timeout
        if (this.runtime.simulation.getSimulationTime() - entry.timestamp > this.macTableTimeout) {
            this.macTable.delete(mac.toUpperCase());
            return null;
        }

        return entry.port;
    }

    getMACTable(): MACTableEntry[] {
        const entries: MACTableEntry[] = [];
        const now = this.runtime.simulation.getSimulationTime();

        this.macTable.forEach((entry, mac) => {
            if (now - entry.timestamp <= this.macTableTimeout) {
                entries.push({ ...entry });
            } else {
                this.macTable.delete(mac);
            }
        });

        return entries;
    }

    clearMACTable(): void {
        this.macTable.clear(); this.seen.clear();
    }

    // For frame forwarding
    getForwardPorts(destinationMAC: string, sourcePort: number): number[] {
        const destPort = this.lookupMAC(destinationMAC);

        if (destinationMAC.toUpperCase() === 'FF:FF:FF:FF:FF:FF') {
            // Broadcast - forward to all ports except source
            return this.ports
                .map((_, i) => i)
                .filter(i => i !== sourcePort && this.ports[i].isConnected());
        }

        if (destPort !== null && destPort !== sourcePort) {
            // Known unicast - forward to specific port
            return [destPort];
        }

        // Unknown unicast - flood to all ports except source
        return this.ports
            .map((_, i) => i)
            .filter(i => i !== sourcePort && this.ports[i].isConnected());
    }

    // Serialization
    toJSON(): SwitchConfig {
        return {
            id: this.id,
            name: this.name,
            type: 'switch',
            position: this.position,
            portCount: this.ports.length,
            ssid: this.ssid,
            ports: this.ports.map(p => p.toJSON()),
        };
    }

    static fromJSON(config: SwitchConfig, runtime: RuntimeDependencies = legacyRuntime): Switch {
        return new Switch(config, runtime);
    }
}

export function createSwitch(config: Partial<SwitchConfig> = {}, runtime: RuntimeDependencies = legacyRuntime): Switch {
    return new Switch({ ...config, type: 'switch' }, runtime);
}
