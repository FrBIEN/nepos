import type { RuntimeDependencies } from '../runtime/RuntimeDependencies';
import { assertRuntimeOwner } from '../runtime/assertRuntimeOwner';
import { legacyRuntime } from '../runtime/LegacyRuntime';
import { Host } from '../hardware/Host';
import { Socket, SocketAddress } from '../transport/Socket';

import { Events } from '../core/EventBus';

export interface SearchHit { name: string; size: number; ip: string; port: number; path: string }
type Message = { type: 'hello' | 'query' | 'hit' | 'get' | 'file' | 'error'; id?: string; text?: string; ttl?: number; hits?: SearchHit[]; path?: string; content?: string; name?: string; encoding?: 'data-url'; mimeType?: string };
interface Link { socket: Socket; remote: SocketAddress }
const key = (address: SocketAddress) => `${address.ip}:${address.port}`;
/** Gnutella-style query flooding with reverse reply paths and TCP file transfer. */
export class PeerToPeer {
    private get runtime() { return this.host?.runtime ?? legacyRuntime; }

    private server: Socket | null = null;
    private links = new Map<string, Link>();
    private seen = new Map<string, Link | null>();
    private shares = new Set<string>();
    private peers = new Map<string, SocketAddress>();
    private hitCallback: (hit: SearchHit) => void = () => {};
    private statusCallback: (status: string) => void = () => {};
    constructor(private host: Host, private port = 6346) {}
    isRunning(): boolean { return !!this.server; }
    getPort(): number { return this.port; }
    getShares(): string[] { return [...this.shares]; }
    rememberPeer(peer: SocketAddress): void { this.peers.set(key(peer), { ...peer }); }
    getPeers(): SocketAddress[] { return [...this.peers.values()].map(p => ({ ...p })); }
    share(path: string): void {
        if (this.runtime.hostFileSystemManager.getOrCreateFileSystem(this.host).readFile(path) === null) throw new Error('Datei nicht gefunden');
        this.shares.add(path); this.changed();
    }
    unshare(path: string): void { this.shares.delete(path); this.changed(); }
    onHit(callback: (hit: SearchHit) => void): () => void { this.hitCallback = callback;return()=>{if(this.hitCallback===callback)this.hitCallback=()=>{};}; }
    onStatus(callback: (status: string) => void): () => void { this.statusCallback = callback;return()=>{if(this.statusCallback===callback)this.statusCallback=()=>{};}; }
    private changed(): void { this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'peer-to-peer' }); }
    start(): boolean {
        if (this.server) return false;
        const server = new Socket('TCP', this.host);
        if (!server.bind(this.port) || !server.listen()) return false;
        this.server = server;
        server.onDisconnect(remote => this.links.delete(key(remote)));
        server.onAccept(remote => { const link = { socket: server, remote }; this.links.set(key(remote), link); server.send({ type: 'hello' }, remote); });
        server.onData(message => { if (message.source) this.receive(message.data as Message, { socket: server, remote: message.source }); });
        this.statusCallback('Dateiaustausch gestartet'); this.changed(); return true;
    }
    connect(ip: string, port = 6346): boolean {
        if (!this.server) this.start();
        const socket = new Socket('TCP', this.host), remote = { ip, port };
        if (this.links.has(key(remote))) return false;
        socket.onConnect(() => { this.links.set(key(remote), { socket, remote }); this.peers.set(key(remote), remote); this.statusCallback(`Verbunden: ${key(remote)}`); this.changed(); });
        socket.onData(m => this.receive(m.data as Message, { socket, remote }));
        socket.onError(e => { this.statusCallback(e.message); socket.close(); });
        socket.onClose(() => { this.links.delete(key(remote)); this.statusCallback(`Getrennt: ${key(remote)}`); });
        return socket.connect(ip, port);
    }
    private send(link: Link, message: Message): void { link.socket.send(message, link.remote); }
    private receive(message: Message, source: Link): void {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'query' && message.id && typeof message.text === 'string') {
            if (this.seen.has(message.id)) return;
            if (this.seen.size >= 2048) this.seen.delete(this.seen.keys().next().value!);
            this.seen.set(message.id, source);
            const hits = this.localSearch(message.text); if (hits.length) this.send(source, { type: 'hit', id: message.id, hits });
            if ((message.ttl ?? 0) > 1 && (message.ttl ?? 0) <= 8) this.links.forEach(link => { if (key(link.remote) !== key(source.remote)) this.send(link, { ...message, ttl: message.ttl! - 1 }); });
        } else if (message.type === 'hit' && message.id && Array.isArray(message.hits)) {
            if (!this.seen.has(message.id)) return;
            const previous = this.seen.get(message.id);
            if (previous) this.send(previous, message); else message.hits.forEach(hit => this.hitCallback(hit));
        } else if (message.type === 'get' && message.path) {
            const content = this.shares.has(message.path) ? this.runtime.hostFileSystemManager.getOrCreateFileSystem(this.host).readFile(message.path) : null;
            const fs = this.runtime.hostFileSystemManager.getOrCreateFileSystem(this.host);
            const binary = content !== null && fs.isBinary(message.path);
            this.send(source, content === null ? { type: 'error', text: 'Datei nicht freigegeben' } : { type: 'file', content, name: message.path.split('/').at(-1), encoding: binary ? 'data-url' : undefined, mimeType: fs.resolveNode(message.path)?.mimeType });
        }
    }
    private localSearch(text: string): SearchHit[] {
        const fs = this.runtime.hostFileSystemManager.getOrCreateFileSystem(this.host), hits: SearchHit[] = [];
        for (const path of this.shares) { const content = fs.readFile(path), name = path.split('/').at(-1)!;
            if (content !== null && name.toLowerCase().includes(text.toLowerCase())) hits.push({ name, path, size: new TextEncoder().encode(content).length, ip: this.host.getIP(), port: this.port });
        } return hits;
    }
    search(text: string): void {
        const id = crypto.randomUUID(); this.seen.set(id, null);
        this.localSearch(text).forEach(hit => this.hitCallback(hit));
        this.links.forEach(link => this.send(link, { type: 'query', id, text, ttl: 5 }));
        this.statusCallback(`Suche über ${this.links.size} Verbindung(en)`);
    }
    download(hit: SearchHit): Promise<string> {
        return new Promise((resolve, reject) => {
            const socket = new Socket('TCP', this.host); let done = false;
            const finish = (error?: Error, path?: string) => { if (done) return; done = true; release(); this.runtime.simulation.clearTimeout(timeout); socket.close(); if (error) reject(error); else resolve(path!); };
            const release = this.runtime.operations.track(() => finish(new Error('Dateiübertragung abgebrochen')));
            const timeout = this.runtime.simulation.setTimeout(() => finish(new Error('Dateiübertragung: Zeitüberschreitung')), 20000);
            socket.onConnect(() => socket.send({ type: 'get', path: hit.path }));
            socket.onError(error => finish(error)); socket.onClose(() => finish(new Error('Verbindung beendet')));
            socket.onData(m => {
                const response = m.data as Message;
                if (response.type === 'error') return finish(new Error(response.text));
                if (response.type !== 'file' || typeof response.content !== 'string') return;
                const name = (response.name || hit.name).split(/[\\/]/).at(-1) || 'download.txt';
                if (name === '.' || name === '..') return finish(new Error('Ungültiger Dateiname'));
                const path = `/home/${name}`, fs = this.runtime.hostFileSystemManager.getOrCreateFileSystem(this.host);
                if (fs.exists(path)) return finish(new Error('Datei existiert bereits'));
                let saved = false;
                if (response.encoding === 'data-url') {
                    const match = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(response.content);
                    try { if (match) saved = fs.writeBytes(path, Uint8Array.from(atob(match[2]), char => char.charCodeAt(0)), match[1]); } catch { /* Reject malformed encoding without changing the target. */ }
                } else saved = fs.writeFile(path, response.content);
                if (!saved) return finish(new Error('Datei konnte nicht gespeichert werden'));
                this.changed(); finish(undefined, path);
            });
            if (!socket.connect(hit.ip, hit.port)) finish(new Error('Verbindung fehlgeschlagen'));
        });
    }
    stop(): void { const links = [...this.links.values()]; this.links.clear(); links.forEach(l => { if (l.socket !== this.server) l.socket.close(); }); this.server?.close(); this.server = null; this.seen.clear(); }
}
export class PeerToPeerManager {
    constructor(private owner?: RuntimeDependencies) {}

    private apps = new Map<string, PeerToPeer>();
    private running = new Set<string>();
    get(hostId: string): PeerToPeer | undefined { return this.apps.get(hostId); }
    remove(hostId: string): void { this.apps.get(hostId)?.stop(); this.apps.delete(hostId); this.running.delete(hostId); }
    getOrCreate(host: Host): PeerToPeer {
        assertRuntimeOwner(host, this.owner); let app = this.apps.get(host.getId()); if (!app) { app = new PeerToPeer(host); this.apps.set(host.getId(), app); } return app; }
    stopAll(): void { this.apps.forEach((app, id) => { if (app.isRunning()) this.running.add(id); app.stop(); }); }
    restart(): void { this.apps.forEach((app, id) => { if (this.running.has(id)) { app.start(); app.getPeers().forEach(p => app.connect(p.ip, p.port)); } });
        this.running.clear();
    }
    getServiceState() { return [...this.apps].map(([hostId, app]) => ({ hostId, running: app.isRunning() || this.running.has(hostId), shares: app.getShares(), peers: app.getPeers() })); }
    restoreServiceState(states: ReturnType<PeerToPeerManager['getServiceState']>, hosts: Host[]): void {
        hosts?.forEach(host => assertRuntimeOwner(host, this.owner));
        this.apps.forEach(app => app.stop()); this.apps.clear(); this.running.clear();
        states.forEach(state => { const host = hosts.find(h => h.getId() === state.hostId); if (!host) return; const app = this.getOrCreate(host);
            state.shares.forEach(path => { try { app.share(path); } catch {} });
            (state.peers || []).forEach(peer => app.rememberPeer(peer));
            if (state.running) this.running.add(state.hostId);
        });
    }
}
export const peerToPeerManager = new PeerToPeerManager();
