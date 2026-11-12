import { eventBus, type EventBus } from '../core/EventBus';
import { simulationEngine } from '../core/SimulationEngine';
export interface PacketLogEntry {
    id: number;
    timestamp: number;
    sourceIP: string;
    sourceMAC: string;
    destIP: string;
    destMAC: string;
    sourcePort?: number;
    destPort?: number;
    transport: string;
    application: string;
    size: number;
    info: string;
    payload?: unknown;
    ttl?: number;
    tcp?: {
        flags: string;
        seq: number;
        ack: number;
    };
    layers?: PacketLayer[];
    color?: string;
    relatedDeviceId?: string; // ID of the device this log entry belongs to (observer)
}
export interface PacketLayer {
    name: string;
    fields: {
        key: string;
        value: string;
    }[];
}
export type PacketRecord = Omit<PacketLogEntry, 'id' | 'timestamp' | 'transport' | 'application'> & {
    protocol?: string;
    transport?: string;
    application?: string;
};
/** Packet history and layer descriptions are usable without constructing any UI. */
export class PacketJournal {
    private entries: PacketLogEntry[] = [];
    private nextId = 1;
    private listeners = new Set<(append: boolean) => void>();
    constructor(private events: EventBus = eventBus, private time: () => number = () => simulationEngine.getSimulationTime(), private maxEntries = 500) { }
    subscribe(listener: (append: boolean) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    clear(): void {
        this.entries = [];
        this.notify(false);
    }
    private notify(append: boolean): void {
        for (const listener of this.listeners)
            try {
                listener(append);
            }
            catch (error) {
                console.error('Paketansicht konnte nicht aktualisiert werden:', error);
            }
    }
    private buildPacketLayers(data: PacketRecord): PacketLayer[] {
        const layers: PacketLayer[] = [];
        // Ethernet Layer
        layers.push({
            name: 'Ethernet II',
            fields: [
                { key: 'Quell-MAC', value: data.sourceMAC || '?' },
                { key: 'Ziel-MAC', value: data.destMAC || '?' },
                { key: 'Typ', value: this.getEtherType(data.protocol ?? 'Unknown') },
            ],
        });
        // IP Layer
        if (['ICMP', 'TCP', 'UDP', 'HTTP', 'DNS', 'DHCP', 'SMTP', 'POP3', 'RIP'].includes(data.protocol ?? 'Unknown')) {
            layers.push({
                name: 'Internet Protocol (IPv4)',
                fields: [
                    { key: 'Quell-IP', value: data.sourceIP || '?' },
                    { key: 'Ziel-IP', value: data.destIP || '?' },
                    { key: 'TTL', value: String(data.ttl ?? '?') },
                    { key: 'Protokoll', value: this.getIPProtocolNumber(data.protocol ?? 'Unknown') },
                ],
            });
        }
        if (data.transport === 'UDP')
            layers.push({ name: 'User Datagram Protocol', fields: [{ key: 'Quellport', value: String(data.sourcePort) }, { key: 'Zielport', value: String(data.destPort) }] });
        // Protocol-specific layer
        switch (data.transport === 'TCP' ? 'TCP' : data.protocol ?? 'Unknown') {
            case 'TCP':
                layers.push({ name: 'Transmission Control Protocol', fields: [
                        { key: 'Quellport', value: String(data.sourcePort ?? '?') },
                        { key: 'Zielport', value: String(data.destPort ?? '?') },
                        { key: 'Flags', value: data.tcp?.flags ?? '?' },
                        { key: 'Seq', value: String(data.tcp?.seq ?? '?') },
                        { key: 'Ack', value: String(data.tcp?.ack ?? '?') },
                    ] });
                break;
            case 'ICMP':
                layers.push({
                    name: 'Internet Control Message Protocol',
                    fields: [
                        { key: 'Typ', value: ({ 'echo-request': '8 (Echo Request)', 'echo-reply': '0 (Echo Reply)', 'time-exceeded': '11 (Time Exceeded)', unreachable: '3 (Destination Unreachable)' } as Record<string, string>)[String((data.payload as {
                                type?: unknown;
                            } | undefined)?.type ?? '')] || '?' },
                        { key: 'Code', value: '0' },
                        { key: 'Beschreibung', value: data.info || '' },
                    ],
                });
                break;
            case 'ARP':
                layers.push({
                    name: 'Address Resolution Protocol',
                    fields: [
                        { key: 'Opcode', value: (data.payload as {
                                opcode?: unknown;
                            } | undefined)?.opcode === 'request' ? '1 (Request)' : '2 (Reply)' },
                        { key: 'Sender MAC', value: data.sourceMAC || '?' },
                        { key: 'Sender IP', value: data.sourceIP || '?' },
                        { key: 'Target IP', value: data.destIP || '?' },
                    ],
                });
                break;
            case 'HTTP':
                const isRequest = data.info?.startsWith('GET') || data.info?.startsWith('POST');
                layers.push({
                    name: 'Hypertext Transfer Protocol',
                    fields: isRequest ? [
                        { key: 'Methode', value: data.info?.split(' ')[0] || 'GET' },
                        { key: 'Pfad', value: data.info?.split(' ')[1] || '/' },
                    ] : [
                        { key: 'Status', value: data.info || '' },
                        { key: 'Größe', value: `${data.size} Bytes` },
                    ],
                });
                break;
            case 'DNS':
                layers.push({
                    name: 'Domain Name System',
                    fields: [
                        { key: 'Typ', value: data.info?.includes('Query') ? 'Query' : 'Response' },
                        { key: 'Info', value: data.info || '' },
                    ],
                });
                break;
            case 'DHCP':
                layers.push({
                    name: 'Dynamic Host Configuration Protocol',
                    fields: [{ key: 'Message-Typ', value: data.info || '' }],
                });
                break;
        }
        // Add payload layer if present
        // Add payload layer if present AND not a TCP Control String
        // (For HTTP/DNS/etc it is handled specific layers usually, but if not fully parsed, we show it here)
        if (data.payload) {
            const p = data.payload;
            // TCP flags belong to the header; control-like strings can be real application data.
            const value = typeof p === 'string' ? p : JSON.stringify(p);
            if (value && value !== '{}' && value !== '""')
                layers.push({ name: 'Nutzdaten (Payload)', fields: [{ key: 'Daten', value }] });
        }
        return layers;
    }
    private getEtherType(protocol: string): string {
        return protocol === 'ARP' ? '0x0806 (ARP)' : '0x0800 (IPv4)';
    }
    private getIPProtocolNumber(protocol: string): string {
        switch (protocol) {
            case 'ICMP': return '1 (ICMP)';
            case 'TCP':
            case 'HTTP': return '6 (TCP)';
            case 'UDP':
            case 'DNS':
            case 'DHCP': return '17 (UDP)';
            default: return '?';
        }
    }
    private resolveProtocols(p: string): {
        transport: string;
        application: string;
    } {
        switch (p) {
            case 'HTTP': return { transport: 'TCP', application: 'HTTP' };
            case 'DNS': return { transport: 'UDP', application: 'DNS' };
            case 'DHCP': return { transport: 'UDP', application: 'DHCP' };
            case 'SMTP': return { transport: 'TCP', application: 'SMTP' };
            case 'POP3': return { transport: 'TCP', application: 'POP3' };
            case 'TCP': return { transport: 'TCP', application: '-' };
            case 'UDP': return { transport: 'UDP', application: '-' };
            case 'ICMP': return { transport: 'ICMP', application: '-' };
            case 'ARP': return { transport: 'ARP', application: '-' };
            default: return { transport: p, application: '-' };
        }
    }
    addEntry(data: Omit<PacketLogEntry, 'id' | 'timestamp' | 'transport' | 'application'> & {
        protocol?: string;
        transport?: string;
        application?: string;
    }): void {
        let transport = data.transport;
        let application = data.application;
        if (!transport || !application) {
            const resolved = this.resolveProtocols(data.protocol || 'Unknown');
            if (!transport)
                transport = resolved.transport;
            if (!application)
                application = resolved.application;
        }
        const entry: PacketLogEntry = {
            id: this.nextId++,
            timestamp: this.time(),
            sourceIP: data.sourceIP,
            sourceMAC: data.sourceMAC,
            destIP: data.destIP,
            destMAC: data.destMAC,
            sourcePort: data.sourcePort,
            destPort: data.destPort,
            transport: transport!,
            application: application!,
            size: data.size,
            info: data.info,
            payload: data.payload,
            layers: data.layers || this.buildPacketLayers(data), // Generate layers if not provided
            color: data.color,
            relatedDeviceId: data.relatedDeviceId, ttl: data.ttl, tcp: data.tcp
        };
        this.entries.push(entry);
        this.events.emit('packet:logged', entry);
        if (this.entries.length > this.maxEntries) {
            this.entries.shift();
        }
        this.notify(true);
    }
    getEntries(): PacketLogEntry[] {
        return [...this.entries];
    }
}
export const packetJournal = new PacketJournal();
