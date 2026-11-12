import { legacyRuntime } from '../runtime/LegacyRuntime';
import type { RuntimeDependencies } from '../runtime/RuntimeDependencies';
import { Knoten, KnotenConfig } from './Knoten';
import { NetzwerkInterface, NetzwerkInterfaceConfig } from './NetzwerkInterface';
import { NetworkPacket } from '../simulation/NetworkPacket';
import { Events } from '../core/EventBus';
import { Icons } from '../assets/DeviceIcons';
import { normalizeIP, isValidMAC } from '../network/utils';

export interface ModemConfig extends KnotenConfig {
    type: 'modem'; networkInterface?: NetzwerkInterfaceConfig; iceServers?: RTCIceServer[];
}
/** Transparent Ethernet bridge over an ordered, reliable WebRTC data channel. */
export class Modem extends Knoten {
    private localInterface: NetzwerkInterface;
    private peerConnection: RTCPeerConnection | null = null;
    private dataChannel: RTCDataChannel | null = null;
    private connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
    private lastError: string | null = null;
    private logs: string[] = [];
    private iceServers: RTCIceServer[];
    private signalingController: AbortController | null = null;
    beginSignaling(): AbortController { this.cancelSignaling(); const controller = new AbortController(); this.signalingController = controller; return controller; }
    cancelSignaling(): void { this.signalingController?.abort(); this.signalingController = null; }
    finishSignaling(controller: AbortController): void { if (this.signalingController === controller) this.signalingController = null; }
    private async connectionOperation<T>(pc: RTCPeerConnection, operation: () => Promise<T>): Promise<T> {
        this.requireConnection(pc);
        let cancel!: (error: Error) => void;
        const cancelled = new Promise<never>((_, reject) => { cancel = reject; });
        this.pendingConnections.add(cancel);
        try { return await Promise.race([operation(), cancelled]); }
        finally { this.pendingConnections.delete(cancel); }
    }
    private requireConnection(pc: RTCPeerConnection): void { if (pc !== this.peerConnection) throw new Error('Verbindungsaufbau abgebrochen'); }
    private pendingConnections = new Set<(error: Error) => void>();
    private generation = 0;
    private incoming: NetworkPacket[] = [];
    private outbound: string[] = [];
    private outboundBytes = 0;
    private fragments = new Map<string, { chunks: string[]; count: number; size: number; started: number }>();
    constructor(config: Partial<ModemConfig> = {}, runtime: RuntimeDependencies = legacyRuntime) {
        super({ ...config, type: 'modem' }, runtime); this.localInterface = new NetzwerkInterface(config.networkInterface, this.runtime); this.iceServers = config.iceServers ?? [];
    }
    protected getDefaultName(): string { return `Modem ${this.runtime.ids.nextName('modem')}`; }
    getPortCount(): number { return 1; }
    getIconPath(): string { return Icons.modem; }
    getNetworkInterface(): NetzwerkInterface { return this.localInterface; }
    getICEServers(): RTCIceServer[] { return structuredClone(this.iceServers); }
    setICEServers(servers: RTCIceServer[]): void {
        if (!Array.isArray(servers) || servers.some(s => !s.urls || (Array.isArray(s.urls) ? s.urls : [s.urls]).some(url => !/^(stun|stuns|turn|turns):/.test(url)))) throw new Error('Ungültige STUN/TURN-Konfiguration');
        this.iceServers = structuredClone(servers);
    }
    private prepare(): RTCPeerConnection {
        if (this.runtime.operations.disposed) throw new Error('Projekt wurde aufgeräumt');
        this.closeConnection(false); this.lastError = null;
        if (typeof RTCPeerConnection === 'undefined') throw new Error('WebRTC ist in diesem Browser nicht verfügbar. HTTPS oder localhost verwenden.');
        const pc = new RTCPeerConnection({ iceServers: this.iceServers }); this.peerConnection = pc; this.connectionStatus = 'connecting'; this.emitStatusChange();
        pc.ondatachannel = e => { if (this.peerConnection === pc) this.setupDataChannel(e.channel); };
        pc.oniceconnectionstatechange = () => { if (this.peerConnection !== pc) return; this.log(`ICE: ${pc.iceConnectionState}`); if (pc.iceConnectionState === 'failed') this.setError('Verbindung fehlgeschlagen. Für getrennte Netze ggf. STUN/TURN konfigurieren.'); };
        return pc;
    }
    private async gather(pc: RTCPeerConnection): Promise<string> {
        if (pc !== this.peerConnection) throw new Error('Verbindungsaufbau abgebrochen');
        if (pc.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => {
            let completed = false;
            const timeout = setTimeout(() => finish(new Error('ICE-Sammlung hat das Zeitlimit überschritten')), 15000);
            const check = () => { if (pc !== this.peerConnection || pc.connectionState === 'closed') finish(new Error('Verbindungsaufbau abgebrochen')); else if (pc.iceGatheringState === 'complete') finish(); };
            const finish = (error?: Error) => { if (completed) return; completed = true; this.pendingConnections.delete(finish); clearTimeout(timeout); pc.removeEventListener('icegatheringstatechange', check); pc.removeEventListener('connectionstatechange', check); if (error) reject(error); else resolve(); };
            this.pendingConnections.add(finish);
            pc.addEventListener('icegatheringstatechange', check); pc.addEventListener('connectionstatechange', check); check();
        });
        if (!pc.localDescription) throw new Error('Lokale Verbindungsbeschreibung fehlt');
        return btoa(JSON.stringify(pc.localDescription.toJSON()));
    }
    async createOffer(): Promise<string> {
        let pc: RTCPeerConnection | undefined;
        try { pc = this.prepare(); const connection = pc;
            return await this.connectionOperation(connection, async () => {
                this.setupDataChannel(connection.createDataChannel('filius-network', { ordered: true }));
                const offer = await connection.createOffer(); this.requireConnection(connection);
                await connection.setLocalDescription(offer); this.requireConnection(connection);
                return this.gather(connection);
            });
        } catch (error) { if (!pc || this.peerConnection === pc) this.setError(String(error)); throw error; }
    }
    private description(token: string, type: 'offer' | 'answer'): RTCSessionDescriptionInit {
        if (token.length > 256000) throw new Error('Verbindungscode zu groß');
        const value = JSON.parse(atob(token.trim())); if (value.type !== type || typeof value.sdp !== 'string') throw new Error('Ungültiger Verbindungscode'); return value;
    }
    async acceptOffer(token: string): Promise<string> {
        let pc: RTCPeerConnection | undefined;
        try { const offer = this.description(token, 'offer'); pc = this.prepare(); const connection = pc;
            return await this.connectionOperation(connection, async () => {
                await connection.setRemoteDescription(offer); this.requireConnection(connection);
                const answer = await connection.createAnswer(); this.requireConnection(connection);
                await connection.setLocalDescription(answer); this.requireConnection(connection);
                return this.gather(connection);
            });
        } catch (error) { if (!pc || this.peerConnection === pc) this.setError(String(error)); throw error; }
    }
    async finalizeConnection(token: string): Promise<void> {
        const pc = this.peerConnection; if (!pc) throw new Error('Zuerst ein Angebot erstellen');
        try { await this.connectionOperation(pc, () => pc.setRemoteDescription(this.description(token, 'answer')));
            this.requireConnection(pc);
            if (this.connectionStatus === 'connected') return;
            await new Promise<void>((resolve, reject) => {
                const subscription = this.runtime.events.on(Events.DEVICE_CONFIG_CHANGED, (event: { device?: Knoten }) => {
                    if (event.device !== this) return;
                    if (this.connectionStatus === 'connected') finish(); else if (this.connectionStatus === 'disconnected') finish(new Error(this.lastError || 'Verbindung getrennt'));
                });
                let completed = false;
                const timeout = setTimeout(() => finish(new Error('WebRTC-Verbindung: Zeitüberschreitung')), 20000);
                const finish = (error?: Error) => { if (completed) return; completed = true; this.pendingConnections.delete(finish); clearTimeout(timeout); subscription.unsubscribe(); if (error) reject(error); else resolve(); };
                this.pendingConnections.add(finish);
                if (pc !== this.peerConnection) finish(new Error('Verbindungsaufbau abgebrochen'));
            });
        } catch (error) { if (!pc || this.peerConnection === pc) this.setError(String(error)); throw error; }
    }
    disconnect(emit = true): void { this.cancelSignaling(); this.closeConnection(emit); }
    private closeConnection(emit: boolean): void {
        this.generation++;
        for (const cancel of [...this.pendingConnections]) cancel(new Error('Verbindungsaufbau abgebrochen'));
        this.pendingConnections.clear();
        const channel = this.dataChannel, pc = this.peerConnection; this.dataChannel = null; this.peerConnection = null;
        channel?.close(); pc?.close(); this.incoming = []; this.outbound = []; this.outboundBytes = 0; this.fragments.clear(); this.connectionStatus = 'disconnected'; if(emit)this.emitStatusChange();
    }
    private setupDataChannel(channel: RTCDataChannel): void {
        const generation = this.generation; this.dataChannel = channel;
        channel.onopen = () => { if (generation !== this.generation) return; this.connectionStatus = 'connected'; this.lastError = null; this.log('Datenkanal verbunden'); this.emitStatusChange(); };
        channel.onclose = () => { if (generation !== this.generation) return; this.disconnect(); };
        channel.onerror = () => { if (generation === this.generation) this.setError('Fehler im WebRTC-Datenkanal'); };
        channel.bufferedAmountLowThreshold = 1024 * 1024;
        channel.onbufferedamountlow = () => { if (generation === this.generation) this.flushOutbound(); };
        channel.onmessage = e => { if (generation === this.generation && typeof e.data === 'string') this.handleRemotePacket(e.data); };
    }
    receivePacket(packet: NetworkPacket, _portIndex: number): void {
        if (this.dataChannel?.readyState !== 'open') return;
        try {
            const data = JSON.stringify(packet, (_key, value) => value instanceof Uint8Array ? { __filiusBytes: [...value] } : value);
            if (data.length > 16 * 1024 * 1024 || this.outboundBytes + data.length * 2 > 32 * 1024 * 1024) { this.log('Paket verworfen: Sendepuffer voll'); return; }
            const id = crypto.randomUUID(), count = Math.ceil(data.length / 1024);
            for (let index = 0; index < count; index++) { const frame = JSON.stringify({ bridge: 'filius-1', id, index, count, chunk: data.slice(index * 1024, (index + 1) * 1024) }); this.outbound.push(frame); this.outboundBytes += frame.length; }
            this.flushOutbound();
        } catch (error) { this.log(String(error)); }
    }
    private flushOutbound(): void {
        const channel = this.dataChannel; if (channel?.readyState !== 'open') return;
        try { while (this.outbound.length && channel.bufferedAmount < 4 * 1024 * 1024) { const frame = this.outbound.shift()!; this.outboundBytes -= frame.length; channel.send(frame); } }
        catch (error) { this.setError(String(error)); }
    }
    private handleRemotePacket(data: string): void {
        if (data.length > 16 * 1024 * 1024 || this.incoming.length >= 1024) return;
        try {
            const frame = JSON.parse(data);
            if (frame.bridge === 'filius-1') {
                for (const [id, pending] of this.fragments) if (Date.now() - pending.started > 30000) this.fragments.delete(id);
                if (typeof frame.id !== 'string' || frame.id.length > 128 || !Number.isInteger(frame.count) || frame.count < 1 || frame.count > 16384 || !Number.isInteger(frame.index) || frame.index < 0 || frame.index >= frame.count || typeof frame.chunk !== 'string' || frame.chunk.length > 1024) return;
                let pending = this.fragments.get(frame.id);
                if (!pending) { if (frame.index !== 0 || this.fragments.size >= 4) return; pending = { chunks: [], count: frame.count, size: 0, started: Date.now() }; this.fragments.set(frame.id, pending); }
                if (frame.index !== pending.chunks.length || frame.count !== pending.count) { this.fragments.delete(frame.id); return; }
                pending.chunks.push(frame.chunk); pending.size += frame.chunk.length;
                if (pending.chunks.length !== pending.count) return;
                this.fragments.delete(frame.id); this.handleRemotePacket(pending.chunks.join('')); return;
            }
            const packet = JSON.parse(data, (_key, value) => value && Array.isArray(value.__filiusBytes) ? new Uint8Array(value.__filiusBytes) : value) as NetworkPacket;
            if (!packet || typeof packet.id !== 'string' || !isValidMAC(packet.sourceMac) || !isValidMAC(packet.destMac) || !normalizeIP(packet.sourceIP) || !normalizeIP(packet.destIP) || !['TCP','UDP','ARP','ICMP','DNS','DHCP','HTTP','SMTP','POP3','RIP'].includes(packet.protocol)) return;
            if (!Number.isInteger(packet.sourcePort) || packet.sourcePort < 0 || packet.sourcePort > 65535 || !Number.isInteger(packet.destPort) || packet.destPort < 0 || packet.destPort > 65535) return;
            if (packet.ttl !== undefined && (!Number.isInteger(packet.ttl) || packet.ttl < 0 || packet.ttl > 255)) return;
            packet.progress = 0; this.incoming.push(packet);
        } catch { this.log('Ungültiges Paket vom Partner verworfen'); }
    }
    /** Remote packets enter the cable queues only on simulation ticks, so pause freezes the bridge. */
    flushIncoming(): void { this.incoming.splice(0).forEach(packet => this.localInterface.sendPacket(packet)); }
    private setError(message: string): void { this.lastError = message; this.disconnect(); this.log(message); }
    private emitStatusChange(): void { this.runtime.events.emit(Events.DEVICE_CONFIG_CHANGED, { device: this }); }
    getStatus() { return this.connectionStatus; }
    getError() { return this.lastError; }
    log(message: string): void { const line = `[${new Date().toLocaleTimeString()}] ${message}`; this.logs.push(line); if (this.logs.length > 200) this.logs.shift(); this.runtime.events.emit('modem:log', { id: this.id, log: line }); }
    getLogs(): string[] { return [...this.logs]; }
    toJSON(): ModemConfig { return { id: this.id, name: this.name, type: 'modem', position: this.position, networkInterface: this.localInterface.toJSON(), iceServers: this.getICEServers() }; }
    static fromJSON(config: ModemConfig, runtime: RuntimeDependencies = legacyRuntime): Modem { return new Modem(config, runtime); }
    static resetNameCounter(): void { legacyRuntime.ids.resetNames('modem'); }
}
export function createModem(config: Partial<ModemConfig> = {}, runtime: RuntimeDependencies = legacyRuntime): Modem { return new Modem(config, runtime); }
