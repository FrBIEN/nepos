import { legacyRuntime } from '../runtime/LegacyRuntime';
import type { RuntimeDependencies } from '../runtime/RuntimeDependencies';
// NetzwerkInterface - Network interface with MAC, IP, subnet, gateway, DNS

import { generateMAC, normalizeIP, normalizeMAC, isValidSubnetMask, isValidMAC } from '../network/utils';
import { Events } from '../core/EventBus';
import { NetworkPacket } from '../simulation/NetworkPacket';

export interface NetzwerkInterfaceConfig {
    mac?: string;
    ip?: string;
    subnetMask?: string;
    gateway?: string;
    dns?: string;
    useDHCP?: boolean;
}

export class NetzwerkInterface {
    private mac: string;
    private ip: string;
    private subnetMask: string;
    private gateway: string;
    private dns: string;
    private useDHCP: boolean;
    // State
    private connected: boolean = false;
    private connectedTo: NetzwerkInterface | null = null;

    isConnected(): boolean {
        return this.connected;
    }

    // Simulation Queue
    private txQueue: NetworkPacket[] = [];
    private rxCount: number = 0; // Stats only

    getTxQueue(): NetworkPacket[] {
        return this.txQueue;
    }

    constructor(config: NetzwerkInterfaceConfig = {}, readonly runtime: RuntimeDependencies = legacyRuntime) {
        if (config.mac && !isValidMAC(normalizeMAC(config.mac))) throw new Error('Ungültige MAC-Adresse');
        if (config.ip && !normalizeIP(config.ip)) throw new Error('Ungültige IP-Adresse');
        if (config.subnetMask && !isValidSubnetMask(config.subnetMask)) throw new Error('Ungültige Netzmaske');
        if (config.gateway && !normalizeIP(config.gateway) || config.dns && !normalizeIP(config.dns)) throw new Error('Ungültiges Gateway oder DNS-Adresse');
        this.mac = config.mac ? normalizeMAC(config.mac) : generateMAC();
        this.ip = config.ip || '192.168.0.10';
        this.subnetMask = config.subnetMask || '255.255.255.0';
        this.gateway = config.gateway || '';
        this.dns = config.dns || '';
        this.useDHCP = config.useDHCP || false;
    }

    /**
     * Queue a packet for transmission
     */
    sendPacket(packet: NetworkPacket): void {
        if (this.txQueue.length >= 4096) { this.runtime.events.emit(Events.PACKET_DROPPED, { packet, reason: 'Sendepuffer voll' }); return; }
        this.txQueue.push(packet);
        // Event for UI to update "Backlog" view
        this.runtime.events.emit('interface:queue', { mac: this.mac, queueSize: this.txQueue.length });
    }

    /**
     * Check if there are packets waiting to be sent
     */
    clearQueue(): void { this.txQueue = []; }

    hasPendingPackets(): boolean {
        return this.txQueue.length > 0;
    }

    /**
     * Retrieve (dequeue) the next packet to put on the wire
     */
    popPendingPacket(): NetworkPacket | undefined {
        const packet = this.txQueue.shift();
        if (packet) {
            this.runtime.events.emit('interface:queue', { mac: this.mac, queueSize: this.txQueue.length });
        }
        return packet;
    }

    /**
     * Receive a packet from the wire
     * (Called by Cable when packet finishes traversal)
     */
    receivePacket(packet: NetworkPacket): void {
        this.rxCount++;

        // Emit event for NetworkStack/OS to handle the valid packet
        this.runtime.events.emit('packet:received', {
            interfaceMac: this.mac,
            packet
        });
    }

    // MAC Address
    getMAC(): string {
        return this.mac;
    }

    setMAC(mac: string): void {
        if (!isValidMAC(normalizeMAC(mac))) throw new Error('Ungültige MAC-Adresse');
        this.mac = normalizeMAC(mac);
    }

    // IP Address
    getIP(): string {
        return this.ip;
    }

    setIP(ip: string): boolean {
        const normalized = normalizeIP(ip);
        if (normalized) {
            this.ip = normalized;
            this.runtime.events.emit(Events.DEVICE_CONFIG_CHANGED, { type: 'ip', value: this.ip });
            return true;
        }
        return false;
    }

    // Subnet Mask
    getSubnetMask(): string {
        return this.subnetMask;
    }

    setSubnetMask(mask: string): boolean {
        const normalized = normalizeIP(mask);
        if (normalized && isValidSubnetMask(normalized)) {
            this.subnetMask = normalized;
            this.runtime.events.emit(Events.DEVICE_CONFIG_CHANGED, { type: 'subnetMask', value: this.subnetMask });
            return true;
        }
        return false;
    }

    // Gateway
    getGateway(): string {
        return this.gateway;
    }

    setGateway(gateway: string): boolean {
        if (gateway === '') {
            this.gateway = '';
            return true;
        }
        const normalized = normalizeIP(gateway);
        if (normalized) {
            this.gateway = normalized;
            this.runtime.events.emit(Events.DEVICE_CONFIG_CHANGED, { type: 'gateway', value: this.gateway });
            return true;
        }
        return false;
    }

    // DNS
    getDNS(): string {
        return this.dns;
    }

    setDNS(dns: string): boolean {
        if (dns === '') {
            this.dns = '';
            return true;
        }
        const normalized = normalizeIP(dns);
        if (normalized) {
            this.dns = normalized;
            this.runtime.events.emit(Events.DEVICE_CONFIG_CHANGED, { type: 'dns', value: this.dns });
            return true;
        }
        return false;
    }

    // DHCP
    isDHCPEnabled(): boolean {
        return this.useDHCP;
    }

    setDHCP(enabled: boolean): void {
        this.useDHCP = enabled;
        this.runtime.events.emit(Events.DEVICE_CONFIG_CHANGED, { type: 'dhcp', value: enabled });
    }

    getConnectedInterface(): NetzwerkInterface | null {
        return this.connectedTo;
    }

    connect(other: NetzwerkInterface): void {
        if (other.runtime !== this.runtime) throw new Error('Anschlüsse gehören zu unterschiedlichen Projekten');
        this.connected = true;
        this.connectedTo = other;
    }

    disconnect(): void {
        this.connected = false;
        this.connectedTo = null;
    }

    // Serialization
    toJSON(): NetzwerkInterfaceConfig {
        return {
            mac: this.mac,
            ip: this.ip,
            subnetMask: this.subnetMask,
            gateway: this.gateway,
            dns: this.dns,
            useDHCP: this.useDHCP,
        };
    }

    static fromJSON(config: NetzwerkInterfaceConfig, runtime: RuntimeDependencies = legacyRuntime): NetzwerkInterface {
        return new NetzwerkInterface(config, runtime);
    }
}
