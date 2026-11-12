import { legacyRuntime } from '../runtime/LegacyRuntime';
// Socket - Abstraction for applications to use TCP/UDP

import { Vermittlungsrechner } from '../hardware/Vermittlungsrechner';
import { Host } from '../hardware/Host';

import { normalizeIP } from '../network/utils';

export type SocketEndpoint = Host | Vermittlungsrechner;

export type SocketType = 'TCP' | 'UDP';
export type SocketState = 'CLOSED' | 'BOUND' | 'LISTENING' | 'CONNECTING' | 'CONNECTED';

export interface SocketAddress {
    ip: string;
    port: number;
}

export interface SocketMessage {
    data: Uint8Array | string | object;
    source?: SocketAddress;
}

export class Socket {
    private get runtime() { return this.host?.runtime ?? legacyRuntime; }

    private type: SocketType;
    private state: SocketState = 'CLOSED';
    private localAddress: SocketAddress | null = null;
    private remoteAddress: SocketAddress | null = null;
    private receiveBuffer: SocketMessage[] = [];
    private onDataCallback: ((message: SocketMessage) => void) | null = null;
    private onDisconnectCallback: ((remote: SocketAddress) => void) | null = null;
    onDisconnect(callback: (remote: SocketAddress) => void): void { this.onDisconnectCallback = callback; }
    triggerDisconnect(remote: SocketAddress): void { this.onDisconnectCallback?.(remote); }
    private onCloseCallback: (() => void) | null = null;
    private onConnectCallback: (() => void) | null = null;
    private onAcceptCallback: ((clientInfo: SocketAddress) => void) | null = null;
    private onErrorCallback: ((error: Error) => void) | null = null;
    private host: SocketEndpoint | null = null;

    // TCP state
    private sequenceNumber: number = Math.floor(Math.random() * 0xFFFFFFFF);
    private acknowledgmentNumber: number = 0;

    constructor(type: SocketType, host?: SocketEndpoint) {
        this.type = type;
        this.host = host || null;
    }

    getHost(): SocketEndpoint | null {
        return this.host;
    }

    setHost(host: SocketEndpoint): void {
        if (this.state !== 'CLOSED') throw new Error('Ein gebundener Socket kann das Gerät nicht wechseln');
        this.host = host;
    }

    getType(): SocketType {
        return this.type;
    }

    getState(): SocketState {
        return this.state;
    }

    getLocalAddress(): SocketAddress | null {
        return this.localAddress;
    }

    getRemoteAddress(): SocketAddress | null {
        return this.remoteAddress;
    }

    /**
     * Bind socket to a local address
     */
    bind(port: number, ip: string = '0.0.0.0'): boolean {
        if (this.runtime.operations.disposed) return false;
        if (!Number.isInteger(port) || port < 0 || port > 65535 || !normalizeIP(ip)) return false;
        if(this.host && !['0.0.0.0','127.0.0.1'].includes(ip) && !(this.host instanceof Host ? this.host.getIP()===ip : this.host.isLocalIP(ip)))return false;
        if (this.state !== 'CLOSED') {
            return false;
        }

        // If port is 0, assign an ephemeral port
        const finalPort = port === 0 ? this.getEphemeralPort() : port;

        if (finalPort < 1 || (this.host && !this.runtime.network.isPortAvailable(this.host, this.type, finalPort))) {
            this.triggerError(new Error('Port bereits belegt oder ungültig')); return false;
        }
        this.localAddress = { ip, port: finalPort };
        this.state = 'BOUND';

        // Emit event for NetworkStack to register listening socket
        if (this.host) {
            console.log(`[Socket] Binding ${this.type} socket on ${this.host.getName()} to port ${finalPort}`);
            this.runtime.events.emit('socket:bind', {
                socket: this,
                host: this.host,
                port: finalPort
            });
        } else {
            console.warn(`[Socket] Binding socket WITHOUT HOST to port ${finalPort} - NetworkStack will not know!`);
        }

        return true;
    }

    /**
     * Listen for incoming connections (TCP only)
     */
    listen(): boolean {
        if (this.type !== 'TCP' || this.state !== 'BOUND') {
            return false;
        }
        this.state = 'LISTENING';
        return true;
    }

    /**
     * Connect to remote address (TCP) or set default destination (UDP)
     */
    connect(ip: string, port: number): boolean {
        if (!normalizeIP(ip) || !Number.isInteger(port) || port < 1 || port > 65535) return false;
        if (this.state === 'CONNECTED' || this.state === 'LISTENING' || this.state === 'CONNECTING') {
            return false;
        }

        this.remoteAddress = { ip, port };

        if (this.state === 'CLOSED') {
            if (!this.bind(0)) return false;
        }

        this.state = 'CONNECTING';

        // Emit connect event for TCP Handshake simulation
        if (this.type === 'TCP') {
            this.runtime.events.emit('socket:connect', {
                socket: this,
                remoteIP: ip,
                remotePort: port,
                localIP: this.localAddress?.ip,
                localPort: this.localAddress?.port
            });
        } else {
            // UDP "connect" is just setting default destination
            this.state = 'CONNECTED'; // UDP is connectionless
        }
        return true;
    }

    /**
     * Called by NetworkStack when TCP Handshake is complete
     */
    completeConnection(): void {
        if (this.state === 'CONNECTING') {
            this.state = 'CONNECTED';
            if (this.onConnectCallback) {
                this.onConnectCallback();
            }
        }
    }

    /**
     * Send data
     */
    send(data: Uint8Array | string | object, destination?: SocketAddress): boolean {
        // Allow sending if CONNECTED, or if LISTENING and destination is provided (Echo Server case)
        if (this.type === 'TCP') {
            const isConnected = this.state === 'CONNECTED';
            const isListeningEncodedResponse = this.state === 'LISTENING' && !!destination;

            if (!isConnected && !isListeningEncodedResponse) {
                return false;
            }
        }

        if (this.type === 'UDP') {
            const dest = destination || this.remoteAddress;
            if (!dest) {
                return false;
            }
        }

        if (!this.localAddress || this.state === 'CLOSED') return false;
        this.runtime.events.emit('socket:send', {
            socket: this,
            data,
            destination: destination || this.remoteAddress,
            source: this.localAddress,
        });

        return true;
    }

    /**
     * Receive data (called by network stack)
     */
    receive(message: SocketMessage): void {
        if (this.state === 'CLOSED') return;
        if (this.onDataCallback) this.onDataCallback(message);
        else if (this.receiveBuffer.length < 1024) this.receiveBuffer.push(message);
    }

    /**
     * Read from receive buffer
     */
    read(): SocketMessage | null {
        return this.receiveBuffer.shift() || null;
    }

    /**
     * Close the socket
     */
    close(): void {
        if (this.state === 'CLOSED') return;
        const localAddr = this.localAddress;

        // Notify NetworkStack to unregister
        if (this.host && localAddr) {
            // Capture state for event
            const hadRemote = !!this.remoteAddress;
            const remoteIP = this.remoteAddress?.ip;
            const remotePort = this.remoteAddress?.port;

            this.state = 'CLOSED';
            this.localAddress = null;
            this.remoteAddress = null;
            this.receiveBuffer = [];

            this.runtime.events.emit('socket:close', {
                socket: this,
                host: this.host,
                port: localAddr.port,
                hadRemote,
                remoteIP,
                remotePort
            });
        }

        this.state = 'CLOSED';
        this.localAddress = null; this.remoteAddress = null; this.receiveBuffer = [];
        if (this.onCloseCallback) {
            this.onCloseCallback();
        }
    }

    /**
     * Event handlers
     */
    onData(callback: (message: SocketMessage) => void): void {
        this.onDataCallback = callback;
    }

    onClose(callback: () => void): void {
        this.onCloseCallback = callback;
    }

    onConnect(callback: () => void): void {
        this.onConnectCallback = callback;
    }

    onError(callback: (error: Error) => void): void {
        this.onErrorCallback = callback;
    }

    /**
     * Register callback for server to be notified of new client connections
     */
    onAccept(callback: (clientInfo: SocketAddress) => void): void {
        this.onAcceptCallback = callback;
    }

    /**
     * Called by NetworkStack when a client completes TCP handshake
     */
    triggerAccept(clientInfo: SocketAddress): void {
        if (this.onAcceptCallback) {
            this.onAcceptCallback(clientInfo);
        }
    }

    triggerError(error: Error): void {
        if (this.onErrorCallback) {
            this.onErrorCallback(error);
        }
    }

    // TCP state for handshake
    getSequenceNumber(): number {
        return this.sequenceNumber;
    }

    incrementSequenceNumber(amount: number = 1): void {
        this.sequenceNumber = (this.sequenceNumber + amount) >>> 0;
    }

    getAcknowledgmentNumber(): number {
        return this.acknowledgmentNumber;
    }

    setAcknowledgmentNumber(ack: number): void {
        this.acknowledgmentNumber = ack;
    }

    private getEphemeralPort(): number {
        const start = Math.floor(Math.random() * 16384);
        for (let offset = 0; offset < 16384; offset++) {
            const port = 49152 + ((start + offset) % 16384);
            if (!this.host || this.runtime.network.isPortAvailable(this.host, this.type, port)) return port;
        }
        return -1;
    }
}

export function createTCPSocket(host?: SocketEndpoint): Socket {
    return new Socket('TCP', host);
}

export function createUDPSocket(host?: SocketEndpoint): Socket {
    return new Socket('UDP', host);
}
