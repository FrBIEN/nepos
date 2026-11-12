import type { RuntimeDependencies } from '../runtime/RuntimeDependencies';
import { assertRuntimeOwner } from '../runtime/assertRuntimeOwner';
import { legacyRuntime } from '../runtime/LegacyRuntime';
import { normalizeIP } from '../network/utils';
import { Events } from '../core/EventBus';

// DNS Server and Client

import { Socket, createUDPSocket, SocketMessage } from '../transport/Socket';
import { UDP } from '../transport/UDP';
import { Host } from '../hardware/Host';

export enum DNSRecordType {
    A = 1,      // IPv4 address
    AAAA = 28,  // IPv6 address
    CNAME = 5,  // Canonical name
    MX = 15,    // Mail exchange
    NS = 2,     // Name server
    PTR = 12,   // Pointer for reverse lookup
    TXT = 16,   // Text record
}

export enum DNSResponseCode {
    NO_ERROR = 0,
    FORMAT_ERROR = 1,
    SERVER_FAILURE = 2,
    NAME_ERROR = 3,    // NXDOMAIN
    NOT_IMPLEMENTED = 4,
    REFUSED = 5,
}

export interface DNSRecord {
    name: string;
    type: DNSRecordType;
    ttl: number;
    value: string;
}

export interface DNSQuery {
    id: number;
    name: string;
    type: DNSRecordType;
    recursionDesired: boolean;
    depth?: number;
}

export interface DNSResponse {
    id: number;
    responseCode: DNSResponseCode;
    authoritative: boolean;
    recursionAvailable: boolean;
    answers: DNSRecord[];
}

// DNS Server
export class DNSServer {
    private get runtime() { return this.host?.runtime ?? legacyRuntime; }

    private records: Map<string, DNSRecord[]> = new Map();
    private socket: Socket | null = null;
    private running: boolean = false;

    addRecord(record: DNSRecord): void {
        record = { ...record, name: record.name.trim().toLowerCase().replace(/\.$/, ''), value: record.value.trim() };
        if (!record.name || !Object.values(DNSRecordType).includes(record.type) || !Number.isFinite(record.ttl) || record.ttl < 0 || (record.type === DNSRecordType.A && !normalizeIP(record.value))) throw new Error('Ungültiger DNS-Eintrag');
        const key = `${record.name.toLowerCase()}_${record.type}`;
        if (!this.records.has(key)) {
            this.records.set(key, []);
        }
        this.records.get(key)!.push({...record});
        this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { host: this.host });
    }

    removeRecord(name: string, type: DNSRecordType): boolean {
        const key = `${name.toLowerCase().replace(/\.$/, '')}_${type}`;
        const removed = this.records.delete(key); this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { host: this.host }); return removed;
    }

    getRecords(name: string, type: DNSRecordType): DNSRecord[] {
        const key = `${name.toLowerCase().replace(/\.$/, '')}_${type}`;
        return this.records.get(key) || [];
    }

    getAllRecords(): DNSRecord[] {
        const all: DNSRecord[] = [];
        this.records.forEach(records => all.push(...records));
        return all;
    }

    // JSON serialization for persistence
    toJSON(): { records: DNSRecord[] } {
        return {
            records: this.getAllRecords(),
        };
    }

    start(): boolean {
        if (this.running) return false;

        this.socket = createUDPSocket();
        this.socket.setHost(this.host!);
        if (!this.socket.bind(UDP.Ports.DNS, this.host ? this.host.getIP() : '0.0.0.0')) { this.socket = null; return false; }
        this.socket.onData(this.handleQuery.bind(this));

        // Register socket with network stack manually if needed,
        // but socket.bind() usually handles it via eventBus.

        this.running = true; this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { host: this.host });
        console.log(`[DNSServer] Started on ${this.host ? this.host.getIP() : 'unknown'}:${UDP.Ports.DNS}`);
        return true;
    }

    stop(): void {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.running = false; this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { host: this.host });
        console.log('[DNSServer] Stopped');
    }

    isRunning(): boolean {
        return this.running;
    }

    constructor(private host?: Host) {
        if (host) this.loadDefaultRecords();
    }

    private async handleQuery(message: SocketMessage): Promise<void> {
        const query = message.data as DNSQuery;
        if (!query || typeof query.name !== 'string' || !Number.isInteger(query.id) || !message.source || !this.socket) return;
        const serverSocket = this.socket;
        let name = query.name.toLowerCase().replace(/\.$/, ''), records: DNSRecord[] = [];
        let responseCode = DNSResponseCode.NAME_ERROR, authoritative = true;
        const depth = query.depth || 0;
        try {
            if (depth > 12) throw new Error('DNS-Verweisschleife');
            const seen = new Set<string>();
            for (let aliases = 0; aliases <= 12; aliases++) {
                if (seen.has(name)) throw new Error('CNAME-Schleife'); seen.add(name);
                records = this.getRecords(name,query.type);
                if (records.length) break;
                const alias = this.getRecords(name,DNSRecordType.CNAME)[0]; if (!alias) break;
                name = alias.value.toLowerCase().replace(/\.$/, '');
            }
            if (!records.length && query.recursionDesired && this.host) {
                const referrals = this.getAllRecords().filter(r => r.type === DNSRecordType.NS && (name === r.name || name.endsWith(`.${r.name}`))).sort((a,b) => b.name.length-a.name.length);
                const referral = referrals[0];
                if (referral) {
                    const ip = normalizeIP(referral.value) || this.getRecords(referral.value,DNSRecordType.A)[0]?.value;
                    if (!ip || ip === this.host.getIP()) throw new Error('Nameserver-Verweis nicht auflösbar');
                    const client = new DNSClient(ip,this.host);
                    try { records = await client.resolve(name,query.type,depth+1); authoritative = false; } finally { client.close(); }
                }
            }
            if (records.length) responseCode = DNSResponseCode.NO_ERROR;
        } catch { responseCode = DNSResponseCode.SERVER_FAILURE; }
        if (this.socket === serverSocket && this.running) serverSocket.send({ id:query.id, responseCode, authoritative, recursionAvailable:true, answers:records.map(r=>({...r,name:query.name})) } satisfies DNSResponse,message.source);
    }

    // Default zone data for common test scenarios
    loadDefaultRecords(): void {
        // Only load localhost if empty? Or always?
        // Let's keep it simple.
        this.addRecord({
            name: 'localhost',
            type: DNSRecordType.A,
            ttl: 86400,
            value: '127.0.0.1',
        });

        if (this.host) {
            this.addRecord({
                name: this.host.getHostname(),
                type: DNSRecordType.A,
                ttl: 86400,
                value: this.host.getIP(),
            });
        }
    }

    clearRecords(): void {
        this.records.clear();
        // optionally re-add localhost if we want it to always persist,
        // but if we are restoring, we assume state contains everything.
        // However, restoring from simple persistence might not have localhost if it wasn't explicit.
        // Let's assume restoration replaces everything.
    }
}

// Host-level DNS server manager (keeps servers running even when desktop closed)
export class HostDnsServerManager {
    constructor(private owner?: RuntimeDependencies) {}

    private servers: Map<string, DNSServer> = new Map(); // hostId -> DNSServer
    private previouslyRunning: Set<string> = new Set(); // Track which servers were running before mode switch

    getOrCreateServer(host: Host): DNSServer {
        assertRuntimeOwner(host, this.owner);
        const hostId = host.getId();
        let server = this.servers.get(hostId);
        if (!server) {
            server = new DNSServer(host);
            this.servers.set(hostId, server);
        }
        return server;
    }

    getServer(hostId: string): DNSServer | null {
        return this.servers.get(hostId) || null;
    }

    removeServer(hostId: string): void {
        const server = this.servers.get(hostId);
        if (server?.isRunning()) {
            server.stop();
        }
        this.servers.delete(hostId);
        this.previouslyRunning.delete(hostId);
    }

    /**
     * Called when switching from Design -> Simulation
     * Restarts servers that were running or should be running
     */
    restartServers(): void {
        console.log(`[HostDnsServerManager] Restarting ${this.servers.size} servers`);
        this.servers.forEach((server, hostId) => {
            // Check if server is already running (from Design Mode interaction)
            // We must force restart to re-bind sockets because NetworkStack is cleared on mode switch
            if (server.isRunning()) {
                console.log(`[HostDnsServerManager] Force restarting server on ${hostId} for simulation context`);
                server.stop();
                server.start();
            } else if (this.previouslyRunning.has(hostId)) {
                server.start();
            }
        });

        this.previouslyRunning.clear();
    }

    /**
     * Called when switching from Simulation -> Design
     * Stops true network sockets but keeps state
     */
    stopAll(): void {
        this.servers.forEach((server, hostId) => {
            if (server.isRunning()) {
                this.previouslyRunning.add(hostId);
                server.stop();
            }
        });
    }

    // Persistence
    getServiceState(): { hostId: string; running: boolean; records: DNSRecord[] }[] {
        const state: { hostId: string; running: boolean; records: DNSRecord[] }[] = [];
        this.servers.forEach((server, hostId) => {
            state.push({
                hostId,
                running: server.isRunning() || this.previouslyRunning.has(hostId),
                records: server.getAllRecords(),
            });
        });
        return state;
    }

    restoreServiceState(state: { hostId: string; running: boolean; records: DNSRecord[] }[], hosts?: Host[]): void {
        hosts?.forEach(host => assertRuntimeOwner(host, this.owner));
        this.servers.forEach(server => server.stop());
        this.servers.clear();
        this.previouslyRunning.clear();

        let restoredCount = 0;

        for (const item of state) {
            let host: Host | undefined;
            if (hosts) {
                host = hosts.find(h => h.getId() === item.hostId);
            }
            // Fallback to global search if possible/needed, but usually hosts are passed

            if (host) {
                const server = new DNSServer(host);

                // Clear defaults carefully.
                // If the saved state has records, we want to use them exactly as saved.
                if (item.records) {
                    server.clearRecords();
                    item.records.forEach(r => server.addRecord(r));
                }

                this.servers.set(item.hostId, server);
                if (item.running) {
                    this.previouslyRunning.add(item.hostId);
                }
                restoredCount++;
            }
        }
        console.log(`[HostDnsServerManager] Restored ${restoredCount} DNS servers`);
    }
}

export const hostDnsServerManager = new HostDnsServerManager();

// DNS Client (resolver)
export class DNSClient {
    private get runtime() { return this.host?.runtime ?? legacyRuntime; }

    private releaseOperation: (() => void) | undefined;
    private dnsServerIP: string;
    private cache: Map<string, { record: DNSRecord; expires: number }> = new Map();
    private pendingQueries: Map<number, {
        resolve: (records: DNSRecord[]) => void;
        reject: (error: Error) => void;
        timeout: number;
    }> = new Map();
    private queryId = 0;
    private socket: Socket | null = null;
    private host: Host | null = null;

    constructor(dnsServerIP: string, host?: Host) {
        this.dnsServerIP = dnsServerIP;
        this.host = host || null;
    }

    setDNSServer(ip: string): void {
        this.dnsServerIP = ip;
    }

    getDNSServer(): string {
        return this.dnsServerIP;
    }

    async resolve(name: string, type: DNSRecordType = DNSRecordType.A, depth = 0): Promise<DNSRecord[]> {
        // Localhost check
        if (name.toLowerCase() === 'localhost' && type === DNSRecordType.A) {
            return [{ name: 'localhost', type: DNSRecordType.A, ttl: 0, value: '127.0.0.1' }];
        }

        // Check cache first
        const cacheKey = `${name.toLowerCase().replace(/\.$/, '')}_${type}`;
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expires > this.runtime.simulation.getSimulationTime()) {
            return [cached.record];
        }

        // Create query
        const queryId = ++this.queryId & 0xFFFF;
        const query: DNSQuery = {
            id: queryId,
            name,
            type,
            recursionDesired: true, depth,
        };

        // Send query and wait for response
        return new Promise((resolve, reject) => {
            if (!this.socket) {
                this.releaseOperation = this.runtime.operations.track(() => this.close());
                this.socket = createUDPSocket(this.host || undefined);
                this.socket.bind(0); // Ephemeral port
                this.socket.onData(this.handleResponse.bind(this));
            }

            // Log for debugging
            console.log(`[DNSClient] Sending query for ${name} to ${this.dnsServerIP}`);

            this.socket.send(query, { ip: this.dnsServerIP, port: UDP.Ports.DNS });

            // Timeout after 5 seconds
            const timeoutMs = 15000;
            const timeout = this.runtime.simulation.setTimeout(() => {
                if (this.pendingQueries.has(queryId)) {
                    this.pendingQueries.delete(queryId);
                    reject(new Error(`DNS query timeout (${timeoutMs}ms)`));
                }
            }, timeoutMs);
            this.pendingQueries.set(queryId, { resolve, reject, timeout });
        });
    }

    private handleResponse(message: SocketMessage): void {
        if (message.source?.ip !== this.dnsServerIP || message.source.port !== UDP.Ports.DNS) return;
        const response = message.data as DNSResponse;
        if (!response || !Array.isArray(response.answers)) return;
        const pending = this.pendingQueries.get(response.id);

        if (pending) {
            this.runtime.simulation.clearTimeout(pending.timeout);
            this.pendingQueries.delete(response.id);

            if (response.responseCode === DNSResponseCode.NO_ERROR) {
                // Cache results
                response.answers.forEach(record => {
                    const cacheKey = `${record.name.toLowerCase()}_${record.type}`;
                    this.cache.set(cacheKey, {
                        record,
                        expires: this.runtime.simulation.getSimulationTime() + record.ttl * 1000,
                    });
                });
                pending.resolve(response.answers);
            } else {
                pending.reject(new Error(`DNS error: ${DNSResponseCode[response.responseCode]}`));
            }
        }
    }

    clearCache(): void {
        this.cache.clear();
    }

    close(): void {
        this.releaseOperation?.(); this.releaseOperation = undefined; this.cache.clear();
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.pendingQueries.forEach(p => { this.runtime.simulation.clearTimeout(p.timeout); p.reject(new Error('DNS-Client geschlossen')); });
        this.pendingQueries.clear();
    }
}
