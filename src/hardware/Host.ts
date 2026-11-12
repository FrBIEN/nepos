import { legacyRuntime } from '../runtime/LegacyRuntime';
import type { RuntimeDependencies } from '../runtime/RuntimeDependencies';
// Host - Computer devices that run applications (Rechner, Notebook)

import { Knoten, KnotenConfig } from './Knoten';
import { NetzwerkInterface, NetzwerkInterfaceConfig } from './NetzwerkInterface';
import type { NetworkPacket } from '../simulation/NetworkPacket';
import { Events } from '../core/EventBus';
import { sameNetwork, normalizeIP } from '../network/utils';

export interface PersonalFirewallRule { protocol: 'tcp' | 'udp'; port: number; localOnly: boolean }
export interface PersonalFirewallConfig { enabled: boolean; blockICMP: boolean; rules: PersonalFirewallRule[] }

export interface HostConfig extends KnotenConfig {
    type: 'rechner' | 'notebook';
    installedApps?: string[];
    color?: string;
    networkInterface?: NetzwerkInterfaceConfig;
    useIPAsName?: boolean;
    wireless?: {enabled:boolean;ssid:string};
    firewall?: PersonalFirewallConfig;
}

export class Host extends Knoten {
    private wireless={enabled:false,ssid:''};
    getWireless(): {enabled:boolean;ssid:string}{return {...this.wireless};}
    setWireless(enabled:boolean,ssid:string):void{if(new TextEncoder().encode(ssid).length>32||ssid.includes('\0'))throw new Error('SSID darf höchstens 32 Bytes umfassen');this.wireless={enabled,ssid};this.runtime.events.emit(Events.DEVICE_CONFIG_CHANGED,{device:this});}
    private firewall: PersonalFirewallConfig = { enabled: false, blockICMP: false, rules: [] };
    private firewallLog: string[] = [];
    private networkInterface: NetzwerkInterface;
    private useIPAsName: boolean;
    private installedApps: Set<string> = new Set();
    private runningApps: Set<string> = new Set();
    private color: string = '#22c55e'; // Default Green (can be customized)

    constructor(config: HostConfig, runtime: RuntimeDependencies = legacyRuntime) {
        super(config, runtime);
        const number = config.name?.match(/^(?:PC|Notebook) (\d+)$/)?.[1];
        if (number) { if (config.type === 'rechner') this.runtime.ids.reserveName('rechner', Number(number)); else this.runtime.ids.reserveName('notebook', Number(number)); }
        if(config.wireless)this.wireless={...config.wireless};
        if (config.firewall) this.firewall = structuredClone(config.firewall);
        this.networkInterface = new NetzwerkInterface(config.networkInterface, this.runtime);
        this.useIPAsName = config.useIPAsName ?? false;

        // Default installed apps
        this.installedApps.add('terminal');
        this.installedApps.add('softwarewizard');

        if (this.type === 'notebook') {
            this.installedApps.add('webbrowser');
        }
    }

    setColor(color: string): void {
        this.color = color;
    }

    getColor(): string {
        return this.color;
    }

    protected getDefaultName(): string {
        if (this.type === 'rechner') {
            return `PC ${this.runtime.ids.nextName('rechner')}`;
        } else {
            return `Notebook ${this.runtime.ids.nextName('notebook')}`;
        }
    }

    static resetNameCounter(): void {
        legacyRuntime.ids.resetNames('rechner');
        legacyRuntime.ids.resetNames('notebook');
    }

    getPortCount(): number {
        return 1; // Single network interface
    }

    getIconPath(): string {
        return this.type === 'rechner' ? 'icons/server.svg' : 'icons/laptop.svg';
    }

    getFirewall(): PersonalFirewallConfig { return structuredClone(this.firewall); }
    setFirewall(config: PersonalFirewallConfig): void {
        if (!Array.isArray(config.rules) || config.rules.some(r => !['tcp','udp'].includes(r.protocol) || !Number.isInteger(r.port) || r.port < 1 || r.port > 65535)) throw new Error('Ungültige Firewall-Regel');
        this.firewall = structuredClone(config); this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { host: this });
    }
    getFirewallLog(): string[] { return [...this.firewallLog]; }
    acceptsPacket(packet: NetworkPacket, established = false): boolean {
        if (!this.firewall.enabled || established) return true;
        const protocol = (packet.transport || packet.protocol).toLowerCase();
        const allowed = protocol === 'icmp' ? !this.firewall.blockICMP : this.firewall.rules.some(r => r.protocol === protocol && r.port === packet.destPort && (!r.localOnly || sameNetwork(packet.sourceIP, this.getIP(), this.networkInterface.getSubnetMask())));
        this.firewallLog.push(`${allowed ? 'Zugelassen' : 'Verworfen'}: ${protocol.toUpperCase()} ${packet.sourceIP}:${packet.sourcePort} → ${packet.destIP}:${packet.destPort}`);
        if (this.firewallLog.length > 200) this.firewallLog.shift(); return allowed;
    }

    // Network interface access
    getNetworkInterface(): NetzwerkInterface {
        return this.networkInterface;
    }

    getIP(): string {
        return this.networkInterface.getIP();
    }

    getMAC(): string {
        return this.networkInterface.getMAC();
    }

    getDisplayName(): string {
        if (this.useIPAsName) {
            return this.networkInterface.getIP();
        }
        return this.name;
    }

    getHostname(): string {
        // Convert name to valid hostname: lowercase, replace spaces/specials with dashes
        return this.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    }

    setUseIPAsName(value: boolean): void {
        this.useIPAsName = value;
    }

    isUsingIPAsName(): boolean {
        return this.useIPAsName;
    }

    // Application management
    setInstalledApps(apps: string[]): void { this.installedApps = new Set(['terminal', 'softwarewizard', ...apps]); }

    getInstalledApps(): string[] {
        return Array.from(this.installedApps);
    }

    installApp(appId: string): void {
        this.installedApps.add(appId);
        // Persist change
        this.runtime.events.emit(Events.DEVICE_CONFIG_CHANGED, { device: this });
    }

    uninstallApp(appId: string): boolean {
        if (appId === 'terminal' || appId === 'softwarewizard') return false; // Can't uninstall core apps
        this.installedApps.delete(appId);

        this.runtime.events.emit(Events.DEVICE_CONFIG_CHANGED, { device: this });

        return true;
    }

    isAppInstalled(appId: string): boolean {
        return this.installedApps.has(appId);
    }

    getRunningApps(): string[] {
        return Array.from(this.runningApps);
    }

    startApp(appId: string): boolean {
        if (!this.installedApps.has(appId)) return false;
        this.runningApps.add(appId);
        return true;
    }

    stopApp(appId: string): void {
        this.runningApps.delete(appId);
    }

    stopAllApps(): void {
        this.runningApps.clear();
    }

    // Serialization
    toJSON(): HostConfig & { installedApps: string[], color: string } {
        return {
            id: this.id,
            name: this.name,
            type: this.type as 'rechner' | 'notebook',
            position: this.position,
            networkInterface: this.networkInterface.toJSON(),
            useIPAsName: this.useIPAsName,
            wireless: this.getWireless(),
            firewall: this.getFirewall(),
            installedApps: Array.from(this.installedApps),
            color: this.color
        };
    }

    static fromJSON(config: HostConfig & { installedApps?: string[], color?: string }, runtime: RuntimeDependencies = legacyRuntime): Host {
        const host = new Host(config, runtime);
        if (config.installedApps) {
            host.setInstalledApps(config.installedApps);
        }
        if (config.color) {
            host.setColor(config.color);
        }
        return host;
    }
    // DNS Resolution
    async resolveHost(domainName: string): Promise<string | null> {
        if (domainName.toLowerCase() === 'localhost') {
            return '127.0.0.1';
        }

        // If it's already an IP, return it
        if (normalizeIP(domainName)) {
            return normalizeIP(domainName);
        }

        const dnsServerIP = this.networkInterface.getDNS();
        if (!dnsServerIP) {
            return null;
        }

        try {
            // Dynamic import to avoid circular dependency
            const epoch = this.runtime.operations.epoch;
            const { DNSClient } = await import('../apps/DNS');
            if (epoch !== this.runtime.operations.epoch) return null;
            const client = new DNSClient(dnsServerIP, this);
            const records = await client.resolve(domainName).finally(() => client.close());

            if (epoch !== this.runtime.operations.epoch) return null;
            if (records.length > 0) {
                return records[0].value;
            }
        } catch (error) {
            console.warn(`[Host] DNS resolution failed for ${domainName}:`, error);
        }

        return null;
    }
}

// Factory functions for convenience
export function createRechner(config: Partial<HostConfig> = {}, runtime: RuntimeDependencies = legacyRuntime): Host {
    return new Host({ ...config, type: 'rechner' }, runtime);
}

export function createNotebook(config: Partial<HostConfig> = {}, runtime: RuntimeDependencies = legacyRuntime): Host {
    return new Host({ ...config, type: 'notebook' }, runtime);
}
