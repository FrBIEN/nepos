import { assertRuntimeOwner } from '../runtime/assertRuntimeOwner';
import type { RuntimeDependencies } from '../runtime/RuntimeDependencies';
import { legacyRuntime } from '../runtime/LegacyRuntime';
import { Vermittlungsrechner } from '../hardware/Vermittlungsrechner';

// DHCP Server and Client

import { Socket, createUDPSocket, SocketMessage, type SocketEndpoint } from '../transport/Socket';
import { UDP } from '../transport/UDP';
import { ipToNumber, numberToIP, normalizeIP, isValidSubnetMask, sameNetwork, getNetworkAddress, getBroadcastAddress, isValidMAC } from '../network/utils';
import { Host } from '../hardware/Host';
import { Events } from '../core/EventBus';

export enum DHCPMessageType {
    DISCOVER = 1,
    OFFER = 2,
    REQUEST = 3,
    DECLINE = 4,
    ACK = 5,
    NAK = 6,
    RELEASE = 7,
    INFORM = 8,
}

export interface DHCPLease {
    ip: string;
    mac: string;
    hostname?: string;
    leaseStart: number;
    leaseEnd: number;
}

export interface DHCPMessage {
    type: DHCPMessageType;
    transactionId: number;
    clientMAC: string;
    clientIP?: string;
    yourIP?: string;
    serverIP?: string;
    options: {
        subnetMask?: string;
        router?: string;
        dns?: string[];
        leaseTime?: number;
        hostname?: string;
        requestedIP?: string;
    };
}

export interface DHCPPoolConfig {
    rangeStart: string;
    rangeEnd: string;
    subnetMask: string;
    router: string;
    dns: string[];
    leaseTime: number; // seconds
}

// DHCP Server
export class DHCPServer {
    private get runtime() { return this.host?.runtime ?? legacyRuntime; }

    private config: DHCPPoolConfig;
    private offers = new Map<string, { mac: string; expires: number }>();
    private leases: Map<string, DHCPLease> = new Map();
    private reservations: Map<string, string> = new Map(); // MAC -> IP
    private socket: Socket | null = null;
    private running: boolean = false;
    private serverIP: string;
    private host: SocketEndpoint | null = null;

    constructor(serverIP: string, config: Partial<DHCPPoolConfig> = {}, host?: SocketEndpoint, private interfaceIndex = 0) {
        this.serverIP = serverIP;
        this.host = host || null;
        this.config = {
            rangeStart: config.rangeStart ?? '192.168.0.100',
            rangeEnd: config.rangeEnd ?? '192.168.0.200',
            subnetMask: config.subnetMask ?? '255.255.255.0',
            router: config.router ?? '192.168.0.1',
            dns: config.dns ?? ['192.168.0.1'],
            leaseTime: config.leaseTime ?? 86400, // 24 hours
        };
        this.setConfig({});
    }

    getInterfaceIndex(): number { return this.interfaceIndex; }

    setConfig(config: Partial<DHCPPoolConfig>): void {
        const next = { ...this.config, ...config };
        if (![next.rangeStart, next.rangeEnd, ...(next.dns || [])].every(ip => !!normalizeIP(ip)) || !isValidSubnetMask(next.subnetMask) || !sameNetwork(next.rangeStart, next.rangeEnd, next.subnetMask) || ipToNumber(next.rangeEnd) < ipToNumber(next.rangeStart) || ipToNumber(next.rangeEnd) - ipToNumber(next.rangeStart) > 65535 || (next.router && !normalizeIP(next.router)) || !Number.isFinite(next.leaseTime) || next.leaseTime < 1) throw new Error('Ungültiger DHCP-Adressbereich');
        this.config = { ...next, dns: [...next.dns] };
        if (this.host) {
            this.runtime.events.emit(Events.DEVICE_CONFIG_CHANGED, { device: this.host });
        }
    }

    getConfig(): DHCPPoolConfig {
        return { ...this.config, dns: [...this.config.dns] };
    }

    // MAC Reservations
    addReservation(mac: string, ip: string): void {
        if (!isValidMAC(mac) || !normalizeIP(ip) || ip === this.serverIP || ip === getNetworkAddress(ip,this.config.subnetMask) || ip === getBroadcastAddress(ip,this.config.subnetMask) || !sameNetwork(ip, this.config.rangeStart, this.config.subnetMask) || [...this.reservations].some(([m, address]) => m !== mac.toUpperCase() && address === ip)) throw new Error('Ungültige oder doppelte Reservierung');
        this.reservations.set(mac.toUpperCase(), ip);
        if (this.host) {
            this.runtime.events.emit(Events.DEVICE_CONFIG_CHANGED, { device: this.host });
        }
    }

    removeReservation(mac: string): void {
        this.reservations.delete(mac.toUpperCase());
        if (this.host) {
            this.runtime.events.emit(Events.DEVICE_CONFIG_CHANGED, { device: this.host });
        }
    }

    getReservations(): { mac: string; ip: string }[] {
        return Array.from(this.reservations.entries()).map(([mac, ip]) => ({ mac, ip }));
    }

    hasReservation(mac: string): boolean {
        return this.reservations.has(mac.toUpperCase());
    }

    start(): boolean {
        // Force restart if already running to ensure socket binding
        if (this.running) {
            this.stop();
        }

        // Close any existing socket before creating new one
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }

        this.setConfig({});
        this.serverIP = (this.host instanceof Vermittlungsrechner ? this.host.getInterface(this.interfaceIndex)?.getIP() : this.host?.getIP()) || this.serverIP;
        this.socket = createUDPSocket(this.host || undefined);
        if (!this.socket.bind(UDP.Ports.DHCP_SERVER, this.serverIP)) { this.socket = null; return false; }
        this.socket.onData(this.handleMessage.bind(this));
        this.running = true;
        console.log(`[DHCPServer] Started on ${this.serverIP}:67`);
        if (this.host) {
            this.runtime.events.emit(Events.DEVICE_CONFIG_CHANGED, { device: this.host });
        }
        return true;
    }

    stop(): void {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.running = false;
        this.offers.clear();
        this.leases.clear(); // Clear leases on stop to ensure fresh state for next simulation
        console.log('[DHCPServer] Stopped and leases cleared');
        if (this.host) {
            this.runtime.events.emit(Events.DEVICE_CONFIG_CHANGED, { device: this.host });
        }
    }

    restart(): boolean {
        this.stop();
        return this.start();
    }

    isRunning(): boolean {
        return this.running;
    }

    private handleMessage(message: SocketMessage): void {
        const msg = message.data as DHCPMessage;
        if (!msg || typeof msg !== 'object' || !msg.options || !Number.isInteger(msg.transactionId) || !isValidMAC(msg.clientMAC)) return;
        msg.clientMAC = msg.clientMAC.toUpperCase();
        console.log(`[DHCPServer] Received message type=${msg.type} from MAC=${msg.clientMAC}`);

        switch (msg.type) {
            case DHCPMessageType.DISCOVER:
                this.handleDiscover(msg);
                break;
            case DHCPMessageType.REQUEST:
                this.handleRequest(msg);
                break;
            case DHCPMessageType.RELEASE:
                this.handleRelease(msg);
                break;
        }
    }

    private handleDiscover(msg: DHCPMessage): void {
        const ip = this.findAvailableIP(msg.clientMAC);
        console.log(`[DHCPServer] DISCOVER from ${msg.clientMAC} -> offering IP: ${ip || 'NONE'}`);
        if (!ip) return;

        this.offers.set(ip, { mac: msg.clientMAC, expires: this.runtime.simulation.getSimulationTime() + 30000 });
        const offer: DHCPMessage = {
            type: DHCPMessageType.OFFER,
            transactionId: msg.transactionId,
            clientMAC: msg.clientMAC,
            yourIP: ip,
            serverIP: this.serverIP,
            options: {
                subnetMask: this.config.subnetMask,
                router: this.config.router,
                dns: this.config.dns,
                leaseTime: this.config.leaseTime,
            },
        };

        console.log(`[DHCPServer] Sending OFFER with IP ${ip} to ${msg.clientMAC}`);
        this.sendBroadcast(offer);
    }

    private handleRequest(msg: DHCPMessage): void {
        if (msg.serverIP && msg.serverIP !== this.serverIP) return;
        const requestedIP = msg.options.requestedIP || msg.clientIP;
        console.log(`[DHCPServer] REQUEST from ${msg.clientMAC} for IP: ${requestedIP}`);
        if (!requestedIP) return;

        // Verify the IP is available or already leased to this MAC
        const existingLease = this.leases.get(requestedIP), nowTime = this.runtime.simulation.getSimulationTime();
        const offer = this.offers.get(requestedIP), reservation = this.reservations.get(msg.clientMAC);
        const inPool = normalizeIP(requestedIP) && ipToNumber(requestedIP) >= ipToNumber(this.config.rangeStart) && ipToNumber(requestedIP) <= ipToNumber(this.config.rangeEnd);
        const reservedForOther = [...this.reservations].some(([mac, ip]) => ip === requestedIP && mac !== msg.clientMAC);
        if ((!inPool && reservation !== requestedIP) || requestedIP === this.serverIP || reservedForOther || (existingLease && existingLease.leaseEnd > nowTime && existingLease.mac !== msg.clientMAC) || (offer && offer.expires > nowTime && offer.mac !== msg.clientMAC)) {
            // IP already leased to someone else
            console.log(`[DHCPServer] NAK - IP ${requestedIP} already leased to ${existingLease?.mac || 'anderem Client'}`);
            const nak: DHCPMessage = {
                type: DHCPMessageType.NAK,
                transactionId: msg.transactionId,
                clientMAC: msg.clientMAC,
                serverIP: this.serverIP,
                options: {},
            };
            this.sendBroadcast(nak);
            return;
        }

        // Create or renew lease
        const now = this.runtime.simulation.getSimulationTime();
        const lease: DHCPLease = {
            ip: requestedIP,
            mac: msg.clientMAC,
            hostname: msg.options.hostname,
            leaseStart: now,
            leaseEnd: now + this.config.leaseTime * 1000,
        };
        this.leases.set(requestedIP, lease);
        this.offers.delete(requestedIP);
        console.log(`[DHCPServer] ACK - leasing ${requestedIP} to ${msg.clientMAC}`);

        const ack: DHCPMessage = {
            type: DHCPMessageType.ACK,
            transactionId: msg.transactionId,
            clientMAC: msg.clientMAC,
            yourIP: requestedIP,
            serverIP: this.serverIP,
            options: {
                subnetMask: this.config.subnetMask,
                router: this.config.router,
                dns: this.config.dns,
                leaseTime: this.config.leaseTime,
            },
        };

        this.sendBroadcast(ack);
    }

    private handleRelease(msg: DHCPMessage): void {
        if (msg.clientIP && this.leases.get(msg.clientIP)?.mac === msg.clientMAC) {
            this.leases.delete(msg.clientIP);
        }
    }

    private findAvailableIP(mac: string): string | null {
        // Check for MAC reservation first
        const reservedIP = this.reservations.get(mac.toUpperCase());
        if (reservedIP) { const lease=this.leases.get(reservedIP); return lease && lease.leaseEnd>this.runtime.simulation.getSimulationTime() && lease.mac.toUpperCase()!==mac.toUpperCase() ? null : reservedIP; }

        // Check if client already has a lease
        for (const [ip, lease] of this.leases) {
            if (lease.mac === mac && lease.leaseEnd > this.runtime.simulation.getSimulationTime()) {
                return ip;
            }
        }

        // Find first available IP in range (not reserved)
        const start = ipToNumber(this.config.rangeStart);
        const end = ipToNumber(this.config.rangeEnd);
        const now = this.runtime.simulation.getSimulationTime();
        const reservedIPs = new Set(this.reservations.values());

        for (let ipNum = start; ipNum <= end; ipNum++) {
            const ip = numberToIP(ipNum);
            // Skip reserved IPs
            if (reservedIPs.has(ip) || ip === this.serverIP || ip === getNetworkAddress(ip, this.config.subnetMask) || ip === getBroadcastAddress(ip, this.config.subnetMask)) continue;
            const offer = this.offers.get(ip); if (offer && offer.expires > now && offer.mac !== mac) continue;

            const lease = this.leases.get(ip);
            if (!lease || lease.leaseEnd < now) {
                return ip;
            }
        }

        return null; // Pool exhausted
    }

    private sendBroadcast(msg: DHCPMessage): void {
        if (this.socket) {
            this.socket.send(msg, { ip: '255.255.255.255', port: UDP.Ports.DHCP_CLIENT });
        }
    }

    getLeases(): DHCPLease[] {
        return Array.from(this.leases.values());
    }

    clearExpiredLeases(): void {
        const now = this.runtime.simulation.getSimulationTime();
        for (const [ip, lease] of this.leases) {
            if (lease.leaseEnd < now) {
                this.leases.delete(ip);
            }
        }
    }
}

// Global manager to track pending DHCP client requests
export class PendingDHCPClientManager {
    private pendingClients: Set<DHCPClient> = new Set();

    register(client: DHCPClient): void {
        this.pendingClients.add(client);
    }

    unregister(client: DHCPClient): void {
        this.pendingClients.delete(client);
    }

    cancelAll(): void {
        console.log(`[PendingDHCPClientManager] Cancelling ${this.pendingClients.size} pending DHCP requests`);
        for (const client of this.pendingClients) {
            client.cancel();
        }
        this.pendingClients.clear();
    }
}

export const pendingDHCPClientManager = new PendingDHCPClientManager();

// DHCP Client
export class DHCPClient {
    private get runtime() { return this.host?.runtime ?? legacyRuntime; }

    private mac: string;
    private hostname?: string;
    private socket: Socket | null = null;
    private transactionId: number = 0;
    private currentLease: DHCPLease | null = null;
    private onConfigured: ((config: { ip: string; subnetMask: string; router: string; dns: string[] }) => void) | null = null;
    private host: Host | null = null;
    private timeoutHandle: number | null = null;
    private completed: boolean = false;
    private cancelled: boolean = false;
    private rejectPending: ((e: Error) => void) | null = null;
    private selectedServer: string | null = null;
    private selectedIP: string | null = null;
    private renewalTimer: number | null = null;
    private expiryTimer: number | null = null;

    constructor(mac: string, hostname?: string, host?: Host) {
        this.mac = mac.toUpperCase();
        this.hostname = hostname;
        this.host = host || null;
    }

    onConfiguration(callback: (config: { ip: string; subnetMask: string; router: string; dns: string[] }) => void): void {
        this.onConfigured = callback;
    }

    /**
     * Cancel this DHCP request (called on mode switch)
     */
    cancel(): void {
        this.cancelled = true;
        const reject = this.rejectPending; this.rejectPending = null;
        if (this.renewalTimer !== null) this.runtime.simulation.clearTimeout(this.renewalTimer);
        if(this.expiryTimer!==null)this.runtime.simulation.clearTimeout(this.expiryTimer);
        this.cleanup(); reject?.(new Error('DHCP-Anfrage abgebrochen'));
        this.runtime.pendingDHCPClientManager.unregister(this);
        console.log(`[DHCPClient] ${this.hostname}: Cancelled`);
    }

    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY_MS = 2000;

    async requestIP(): Promise<{ ip: string; subnetMask: string; router: string; dns: string[] }> {
        // Register with pending manager
        this.runtime.pendingDHCPClientManager.register(this);

        try {
            for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
                // Check if cancelled
                if (this.cancelled) {
                    throw new Error('DHCP request cancelled');
                }

                try {
                    const result = await this.sendDHCPDiscover();
                    return result;
                } catch (error) {
                    console.log(`DHCP attempt ${attempt + 1} failed: ${error}`);
                    if (attempt < this.MAX_RETRIES && !this.cancelled) {
                        const scaledDelay = this.RETRY_DELAY_MS;
                        await this.delay(scaledDelay);
                    }
                }
            }
            if (this.cancelled) throw new Error('DHCP-Anfrage abgebrochen');
            // Fall back to APIPA
            console.log('DHCP failed, using APIPA address');
            return this.generateAPIPA();
        } finally {
            // Always unregister when done
            if (!this.currentLease) this.runtime.pendingDHCPClientManager.unregister(this);
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve, reject) => { this.rejectPending = reject; this.timeoutHandle = this.runtime.simulation.setTimeout(() => { this.rejectPending = null; resolve(); }, ms); });
    }

    private generateAPIPA(): { ip: string; subnetMask: string; router: string; dns: string[] } {
        // APIPA range: 169.254.1.0 - 169.254.254.255
        const randomHost = Math.floor(Math.random() * 65024) + 256;
        const octet3 = Math.floor(randomHost / 256);
        const octet4 = randomHost % 256;
        return {
            ip: `169.254.${octet3}.${octet4}`,
            subnetMask: '255.255.0.0',
            router: '',
            dns: []
        };
    }

    private sendDHCPDiscover(): Promise<{ ip: string; subnetMask: string; router: string; dns: string[] }> {
        return new Promise((resolve, reject) => {
            this.rejectPending = reject; this.selectedServer = null; this.selectedIP = null;
            this.transactionId = Math.floor(Math.random() * 0xFFFFFFFF);
            this.completed = false;

            // Create socket only once
            if (!this.socket) {
                console.log(`[DHCPClient] ${this.hostname}: Creating socket and binding to port 68`);
                this.socket = createUDPSocket(this.host || undefined);
                if (!this.socket.bind(UDP.Ports.DHCP_CLIENT)) { this.cleanup(); reject(new Error('DHCP-Client-Port bereits belegt')); return; }
                // Set onData handler only once when socket is created
                this.socket.onData(this.handleMessage.bind(this, resolve, reject));
            }

            // Send DISCOVER
            console.log(`[DHCPClient] ${this.hostname}: Sending DISCOVER (txid: ${this.transactionId})`);
            const discover: DHCPMessage = {
                type: DHCPMessageType.DISCOVER,
                transactionId: this.transactionId,
                clientMAC: this.mac,
                options: {
                    hostname: this.hostname,
                },
            };

            this.socket.send(discover, { ip: '255.255.255.255', port: UDP.Ports.DHCP_SERVER });

            // Timeout - clear any previous timeout first
            if (this.timeoutHandle) {
                this.runtime.simulation.clearTimeout(this.timeoutHandle);
            }
            const scaledTimeout = 15000;
            this.timeoutHandle = this.runtime.simulation.setTimeout(() => {
                if (!this.completed) {
                    this.cleanup();
                    reject(new Error(`DHCP timeout (${scaledTimeout}ms)`));
                }
            }, scaledTimeout);
        });
    }

    private cleanup(): void {
        this.rejectPending = null;
        if (this.timeoutHandle) {
            this.runtime.simulation.clearTimeout(this.timeoutHandle);
            this.timeoutHandle = null;
        }
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
    }

    private handleMessage(
        resolve: (config: { ip: string; subnetMask: string; router: string; dns: string[] }) => void,
        reject: (error: Error) => void,
        message: SocketMessage
    ): void {
        // Ignore if already completed (prevents stale callbacks)
        if (this.completed) {
            console.log(`[DHCPClient] ${this.hostname}: Ignoring message - already completed`);
            return;
        }

        const msg = message.data as DHCPMessage;
        if (!msg || !msg.options || message.source?.port !== 67) return;
        console.log(`[DHCPClient] ${this.hostname}: Received message type=${msg.type}, txid=${msg.transactionId}, myTxid=${this.transactionId}`);

        if (msg.transactionId !== this.transactionId) {
            console.log(`[DHCPClient] ${this.hostname}: Ignoring - wrong transaction ID`);
            return;
        }
        if (msg.clientMAC !== this.mac) {
            console.log(`[DHCPClient] ${this.hostname}: Ignoring - wrong MAC (got ${msg.clientMAC}, expected ${this.mac})`);
            return;
        }

        switch (msg.type) {
            case DHCPMessageType.OFFER:
                if (this.selectedServer || !msg.serverIP || !normalizeIP(msg.serverIP) || !msg.yourIP || !normalizeIP(msg.yourIP)) return;
                this.selectedServer = msg.serverIP; this.selectedIP = msg.yourIP;
                console.log(`[DHCPClient] ${this.hostname}: Got OFFER for IP ${msg.yourIP}`);
                // Send REQUEST for the offered IP
                const request: DHCPMessage = {
                    type: DHCPMessageType.REQUEST,
                    transactionId: this.transactionId,
                    clientMAC: this.mac,
                    serverIP: this.selectedServer!,
                    options: {
                        requestedIP: msg.yourIP,
                        hostname: this.hostname,
                    },
                };
                console.log(`[DHCPClient] ${this.hostname}: Sending REQUEST for ${msg.yourIP}`);
                this.socket?.send(request, { ip: '255.255.255.255', port: UDP.Ports.DHCP_SERVER });
                break;

            case DHCPMessageType.ACK:
                if (msg.serverIP !== this.selectedServer || message.source?.ip!==msg.serverIP || msg.yourIP !== this.selectedIP || !isValidSubnetMask(msg.options.subnetMask || '') || (msg.options.router && !normalizeIP(msg.options.router)) || (msg.options.dns && (!Array.isArray(msg.options.dns)||msg.options.dns.some(ip=>!normalizeIP(ip)))) || (msg.options.leaseTime!==undefined&&(!Number.isFinite(msg.options.leaseTime)||msg.options.leaseTime<=0))) return;
                console.log(`[DHCPClient] ${this.hostname}: Got ACK! IP=${msg.yourIP}`);
                this.completed = true;

                const config = {
                    ip: msg.yourIP!,
                    subnetMask: msg.options.subnetMask!,
                    router: msg.options.router!,
                    dns: msg.options.dns || [],
                };

                this.currentLease = {
                    ip: msg.yourIP!,
                    mac: this.mac,
                    leaseStart: this.runtime.simulation.getSimulationTime(),
                    leaseEnd: this.runtime.simulation.getSimulationTime() + (msg.options.leaseTime || 86400) * 1000,
                };

                // Cleanup before resolving
                this.cleanup();

                if (this.onConfigured) {
                    this.onConfigured(config);
                }
                if (this.host) { if (this.renewalTimer !== null) this.runtime.simulation.clearTimeout(this.renewalTimer); this.renewalTimer = this.runtime.simulation.setTimeout(() => { void this.requestIP().then(next => { if (this.cancelled) return; const iface = this.host!.getNetworkInterface(); iface.setIP(next.ip); iface.setSubnetMask(next.subnetMask); iface.setGateway(next.router); iface.setDNS(next.dns[0] || ''); }).catch(() => {}); }, (msg.options.leaseTime || 86400) * 500); }
                if(this.expiryTimer!==null)this.runtime.simulation.clearTimeout(this.expiryTimer);
                this.expiryTimer=this.runtime.simulation.setTimeout(()=>{
                    const leasedIP=this.currentLease?.ip;this.currentLease=null;
                    if(this.host && leasedIP && this.host.getIP()===leasedIP){const iface=this.host.getNetworkInterface();iface.setIP('0.0.0.0');iface.setGateway('');iface.setDNS('');}
                },(msg.options.leaseTime||86400)*1000);
                resolve(config);
                break;

            case DHCPMessageType.NAK:
                if (msg.serverIP !== this.selectedServer) return;
                this.completed = true;
                this.cleanup();
                reject(new Error('DHCP request rejected'));
                break;
        }
    }

    release(): void {
        if (this.currentLease) {
            this.cancel();
            const socket = createUDPSocket(this.host || undefined); if (!socket.bind(68)) return;
            const release: DHCPMessage = {
                type: DHCPMessageType.RELEASE,
                transactionId: Math.floor(Math.random() * 0xFFFFFFFF),
                clientMAC: this.mac,
                clientIP: this.currentLease.ip,
                options: {},
            };
            socket.send(release, { ip: '255.255.255.255', port: UDP.Ports.DHCP_SERVER });
            socket.close(); this.currentLease = null; this.cancel();
        }
    }

    getCurrentLease(): DHCPLease | null {
        return this.currentLease;
    }

    close(): void { this.cancel(); }
}

// Host-level DHCP server manager (keeps servers running even when desktop closed)
export class HostDhcpServerManager {
    constructor(private owner?: RuntimeDependencies) {}
    private get runtime() { return this.owner ?? legacyRuntime; }

    private servers: Map<string, DHCPServer> = new Map(); // hostId -> DHCPServer
    private previouslyRunning: Set<string> = new Set(); // Track which servers were running before mode switch

    getOrCreateServer(host: SocketEndpoint, config?: DHCPPoolConfig, interfaceIndex = host instanceof Vermittlungsrechner ? 1 : 0): DHCPServer {
        assertRuntimeOwner(host, this.owner);
        const hostId = host.getId();
        let server = this.servers.get(hostId);
        if (!server) {
            const serverIP = host instanceof Vermittlungsrechner ? host.getInterface(interfaceIndex)!.getIP() : host.getIP();
            const defaultConfig: DHCPPoolConfig = {
                rangeStart: serverIP.replace(/\.\d+$/, '.10'),
                rangeEnd: serverIP.replace(/\.\d+$/, '.100'),
                subnetMask: '255.255.255.0',
                router: serverIP,
                dns: [serverIP],
                leaseTime: 86400,
            };
            server = new DHCPServer(serverIP, config || defaultConfig, host, interfaceIndex);
            this.servers.set(hostId, server);
        }
        return server;
    }

    getServer(hostId: string): DHCPServer | null {
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
     * Stop all servers but remember which ones were running
     * Call this when switching to design mode
     */
    stopAllAndRemember(): void {
        this.servers.forEach((server, hostId) => {
            if (server.isRunning()) {
                this.previouslyRunning.add(hostId);
                server.stop();
            }
        });
        console.log(`[HostDhcpServerManager] Stopped ${this.previouslyRunning.size} servers, will restart on simulation entry`);
    }

    /**
     * Restart servers that were previously running
     * Call this when switching to simulation mode
     */
    restartPrevious(): void {
        console.log(`[HostDhcpServerManager] Restarting ${this.servers.size} servers`);
        this.servers.forEach((server, id) => { if (this.previouslyRunning.has(id)) server.start(); });

        this.previouslyRunning.clear();
    }

    /**
     * Check if any DHCP servers exist
     */
    hasServers(): boolean {
        return this.servers.size > 0;
    }

    clear(): void {
        this.servers.forEach(server => {
            if (server.isRunning()) {
                server.stop();
            }
        });
        this.servers.forEach(server => server.stop());
        this.servers.clear();
        this.previouslyRunning.clear();
    }

    /**
     * Get current service state for saving
     */
    getServiceState(): { hostId: string; running: boolean; interfaceIndex?: number; config?: DHCPPoolConfig; reservations?: { mac: string; ip: string }[] }[] {
        const state: { hostId: string; running: boolean; interfaceIndex?: number; config?: DHCPPoolConfig; reservations?: { mac: string; ip: string }[] }[] = [];

        // Add running/configured servers
        this.servers.forEach((server, hostId) => {
            // A server is considered "running" for persistence if it is currently running OR
            // if it was running before we switched to design mode (previouslyRunning).
            const isActive = server.isRunning() || this.previouslyRunning.has(hostId);

            state.push({
                hostId,
                interfaceIndex: server.getInterfaceIndex(),
                running: isActive,
                config: server.getConfig(),
                reservations: server.getReservations()
            });
        });

        return state;
    }

    /**
     * Restore service state from saved data
     */
    /**
     * Restore service state from saved data
     * @param state Saved service state
     * @param hosts Optional list of hosts to use for restoration (required if NetworkStack is empty, e.g. during load)
     */
    restoreServiceState(state: { hostId: string; running: boolean; interfaceIndex?: number; config?: DHCPPoolConfig; reservations?: { mac: string; ip: string }[] }[], hosts?: SocketEndpoint[]): void {
        hosts?.forEach(host => assertRuntimeOwner(host, this.owner));
        this.previouslyRunning.clear();
        this.servers.forEach(server => server.stop());
        this.servers.clear();
        // Use the global networkStack instance if no hosts provided, otherwise look in provided array

        for (const item of state) {
            let host: SocketEndpoint | undefined;

            if (hosts) {
                host = hosts.find(h => h.getId() === item.hostId);
            } else {
                host = this.runtime.network.findHostById(item.hostId);
            }

            if (host) {
                // Recreate server with saved config
                const server = this.getOrCreateServer(host, item.config, item.interfaceIndex);

                // Restore reservations
                if (item.reservations) {
                    item.reservations.forEach(res => server.addReservation(res.mac, res.ip));
                }

                // Restore running state
                if (item.running) {
                    console.log(`[HostDhcpServerManager] Restoring server for ${item.hostId} to RUNNING state`);
                    this.previouslyRunning.add(item.hostId);
                } else {
                    console.log(`[HostDhcpServerManager] Restoring server for ${item.hostId} to STOPPED state`);
                }
            } else {
                console.warn(`[HostDhcpServerManager] Could not restore DHCP server for unknown host ID: ${item.hostId}`);
            }
        }
        console.log(`[HostDhcpServerManager] Restored ${this.servers.size} DHCP servers`);
    }
}

export const hostDhcpServerManager = new HostDhcpServerManager();
