import type { RuntimeDependencies } from '../runtime/RuntimeDependencies';
import { assertRuntimeOwner } from '../runtime/assertRuntimeOwner';
import { legacyRuntime } from '../runtime/LegacyRuntime';
import { Events } from '../core/EventBus';
import { Host } from '../hardware/Host';
import { Socket, createTCPSocket, SocketMessage } from '../transport/Socket';

export class EchoServer {
    private get runtime() { return this.host?.runtime ?? legacyRuntime; }

    private host: Host;
    private port: number;
    private running: boolean = false;
    private serverSocket: Socket | null = null;
    private onMessageCallback: ((msg: string) => void) | null = null;

    constructor(host: Host, port: number = 55555) {
        this.host = host;
        this.port = port;
    }

    setPort(port: number): void { if (this.running) throw new Error("Server zuerst stoppen"); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Ungültiger Port"); this.port = port; }

    start(): void {
        if (this.running) return;

        try {
            this.serverSocket = createTCPSocket(this.host);
            // Socket.bind(port, ip)
            if (!this.serverSocket.bind(this.port, this.host.getIP()) || !this.serverSocket.listen()) throw new Error('Port bereits belegt');

            this.serverSocket.onData((msg: SocketMessage) => {
                const data = typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data);
                const logMsg = `Received from ${msg.source?.ip}:${msg.source?.port}: ${data}`;
                console.log(`[EchoServer] ${logMsg}`);
                if (this.onMessageCallback) this.onMessageCallback(logMsg);

                // Echo back to source
                if (msg.source) {
                    this.serverSocket?.send(msg.data, msg.source);
                    const echoMsg = `Echoed to ${msg.source?.ip}:${msg.source?.port}`;
                    if (this.onMessageCallback) this.onMessageCallback(echoMsg);
                }
            });

            this.running = true;
            this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { host: this.host });
        } catch (e) {
            console.error('[EchoServer] Failed to start:', e);
            this.stop();
        }
    }

    stop(): void {
        this.running = false;
        this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { host: this.host });
        if (this.serverSocket) {
            this.serverSocket.close();
            this.serverSocket = null;
        }
    }

    isRunning(): boolean {
        return this.running;
    }

    getPort(): number {
        return this.port;
    }

    onMessage(callback: (msg: string) => void): () => void {
        this.onMessageCallback = callback;return()=>{if(this.onMessageCallback===callback)this.onMessageCallback=null;};
    }
}

export class HostEchoServerManager {
    constructor(private owner?: RuntimeDependencies) {}

    private servers: Map<string, EchoServer> = new Map();
    private previouslyRunning = new Set<string>();

    removeServer(hostId: string): void { this.servers.get(hostId)?.stop(); this.servers.delete(hostId); this.previouslyRunning.delete(hostId); }
    getServer(hostId: string): EchoServer | undefined {
        return this.servers.get(hostId);
    }

    getOrCreateServer(host: Host, port: number = 55555): EchoServer {
        assertRuntimeOwner(host, this.owner);
        let server = this.servers.get(host.getId());
        if (!server) {
            server = new EchoServer(host, port);
            this.servers.set(host.getId(), server);
        }
        if (!server.isRunning()) server.setPort(port);
        return server;
    }

    stopAll(): void {
        this.servers.forEach((server, id) => { if (server.isRunning()) this.previouslyRunning.add(id); server.stop(); });
    }

    getServiceState(): { hostId: string; port: number; running: boolean }[] {
        return Array.from(this.servers.entries()).map(([hostId, server]) => ({
            hostId,
            port: server.getPort(),
            running: server.isRunning() || this.previouslyRunning.has(hostId)
        }));
    }

    restoreServiceState(states: { hostId: string; port: number; running: boolean }[], hosts: Host[]): void {
        hosts?.forEach(host => assertRuntimeOwner(host, this.owner));
        this.servers.forEach(server => server.stop());
        this.servers.clear();
        this.previouslyRunning.clear();
        states.forEach(state => {
            const host = hosts.find(h => h.getId() === state.hostId);
            if (host) {
                const server = new EchoServer(host, state.port);
                this.servers.set(state.hostId, server);
                if (state.running) {
                    this.previouslyRunning.add(state.hostId);
                }
            }
        });
    }

    restartServers(): void {
        this.servers.forEach((server, id) => { if (this.previouslyRunning.has(id)) server.start(); });

        this.previouslyRunning.clear();
    }
}

export const hostEchoServerManager = new HostEchoServerManager();
