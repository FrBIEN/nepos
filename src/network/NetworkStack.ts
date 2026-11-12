import { eventBus, Events } from '../core/EventBus';
import { simulationEngine } from '../core/SimulationEngine';
import { Host } from '../hardware/Host';
import { Knoten } from '../hardware/Knoten';
import { Kabel } from '../hardware/Kabel';
import { Switch } from '../hardware/Switch';
import { Vermittlungsrechner } from '../hardware/Vermittlungsrechner';
import { Modem } from '../hardware/Modem';
import { NetzwerkInterface } from '../hardware/NetzwerkInterface';
import { routerResponse } from './RouterManagement';
import { Socket, SocketAddress, SocketEndpoint } from '../transport/Socket';
import { NetworkPacket, clonePacket } from '../simulation/NetworkPacket';
import { packetJournal } from './PacketJournal';
import { NAT } from './NAT';
import { getBroadcastAddress, sameNetwork } from './utils';

interface Port { device: Knoten; iface: NetzwerkInterface; index: number }
interface Neighbor { mac: string; expires: number }
interface Pending { port: Port; ip: string; packets: NetworkPacket[]; attempts: number; retryAt: number }
interface Connection {
    socket: Socket; remote: SocketAddress; state: 'syn-sent' | 'syn-received' | 'established';
    local: number; localIP: string; closing?: boolean; finSent?: number; finReceived?: boolean; expires?: number;
    seq: number; ack: number; pending: Map<number, { packet: NetworkPacket; retryAt: number; attempts: number }>;
}
export interface ProbeResult { success: boolean; ip: string; time?: number; ttl?: number; error?: string; exceeded?: boolean }

/** All delivery goes through interface queues and cables, including ARP, ICMP and TCP control. */
export class NetworkStack {
    private disposed = false;
    private subscriptions: {unsubscribe: () => void}[] = [];
    private listen<T>(event: string, callback: (data: T) => void): void { this.subscriptions.push(this.events.on(event, callback)); }
    dispose(): void { if (this.disposed) return; this.clear(); this.cables.forEach(cable => cable.disconnect()); this.updateTopology([], []); for (const subscription of this.subscriptions) subscription.unsubscribe(); this.subscriptions = []; this.disposed = true; }
    private routerServices = new Map<Vermittlungsrechner,Socket>();
    private udpFlows = new Map<string, number>();
    private nat = new NAT();
    private nextRIP = 0;
    private nodes: Knoten[] = [];
    private cables: Kabel[] = [];
    private sockets = new Map<string, Socket>();
    private neighbors = new Map<NetzwerkInterface, Map<string, Neighbor>>();
    private pendingARP = new Map<string, Pending>();
    private connections = new Map<string, Connection>();
    private probes = new Map<string, { resolve: (result: ProbeResult) => void; started: number; deadline: number; host: Host }>();
    private loopback: { port: Port; packet: NetworkPacket }[] = [];
    private now = 0;
    private speed = 100;
    private packetId = 0;
    private origin = crypto.randomUUID();
    constructor(private events = eventBus, private simulation = simulationEngine, private journal = packetJournal) {
        this.listen('socket:bind', (e: { socket: Socket; host: SocketEndpoint; port: number }) => {
            const key = this.socketKey(e.host, e.socket.getType(), e.port);
            if (this.sockets.has(key)) { e.socket.triggerError(new Error('Port bereits belegt')); return; }
            this.sockets.set(key, e.socket);
        });
        this.listen('socket:send', (e: { socket: Socket; data: NetworkPacket['payload']; destination: SocketAddress }) => this.sendSocket(e.socket, e.data, e.destination));
        this.listen('socket:connect', (e: { socket: Socket }) => this.connect(e.socket));
        this.listen('socket:close', (e: { socket: Socket; host: SocketEndpoint; port: number }) => this.closeSocket(e.socket, e.host, e.port));
        this.listen('packet:received', (e: { interfaceMac: string; packet: NetworkPacket }) => {
            const port = this.ports().find(p => p.iface.getMAC().toUpperCase() === e.interfaceMac.toUpperCase());
            if (port) this.receive(port, e.packet);
        });
        this.listen(Events.SIMULATION_TICK, (e: { deltaMs: number }) => this.tick(e.deltaMs));
        this.listen(Events.SIMULATION_STOP, () => this.clear());
    }
    private ports(): Port[] {
        return this.nodes.flatMap(device => {
            const ifaces = device instanceof Host || device instanceof Modem ? [device.getNetworkInterface()]
                : device instanceof Switch ? device.getPorts() : device instanceof Vermittlungsrechner ? device.getInterfaces() : [];
            return ifaces.map((iface, index) => ({ device, iface, index }));
        });
    }
    private hostPort(host: SocketEndpoint, destIP?: string): Port {
        if(host instanceof Host)return {device:host,iface:host.getNetworkInterface(),index:0};
        const index=(destIP && host.findRoute(destIP)?.interfaceIndex)||0;return {device:host,iface:host.getInterface(index)!,index};
    }
    private socketKey(host: SocketEndpoint, type: string, port: number): string { return `${host.getId()}:${type}:${port}`; }
    private connKey(host: SocketEndpoint, local: number, remote: SocketAddress): string { return `${host.getId()}:${local}:${remote.ip}:${remote.port}`; }
    isPortAvailable(host: SocketEndpoint, type: string, port: number): boolean { return !this.sockets.has(this.socketKey(host, type, port)); }
    getHosts(): Host[] { return this.nodes.filter((n): n is Host => n instanceof Host); }
    findHostById(id: string): Host | undefined { return this.getHosts().find(h => h.getId() === id); }
    findHostByIP(ip: string): Host | undefined { return this.getHosts().find(h => h.getIP() === ip); }
    findHostByMAC(mac: string): Host | undefined { return this.getHosts().find(h => h.getMAC().toUpperCase() === mac.toUpperCase()); }
    setSimulationSpeed(speed: number): void { if (Number.isFinite(speed)) { this.speed = Math.max(1, Math.min(300, speed)); this.simulation.setSpeedMultiplier(this.speed / 100); } }
    getDelayMultiplier(): number { return 100 / this.speed; }
    updateTopology(nodes: Knoten[], cables: Kabel[]): void {
        if (this.disposed) throw new Error('Netzwerk wurde aufgeräumt');
        if (nodes.some(node => node.runtime.events !== this.events) || cables.some(cable => cable.runtime.events !== this.events)) throw new Error('Topologie gehört zu einem anderen Projekt');
        const removed = this.nodes.filter(n => !nodes.includes(n));
        for (const node of removed) if (node instanceof Modem) node.disconnect();
        for (const socket of this.sockets.values()) if (removed.includes(socket.getHost()!)) socket.close();
        this.nodes = [...nodes]; this.cables = [...cables];
        this.neighbors.clear(); this.pendingARP.clear();
        this.events.emit(Events.TOPOLOGY_UPDATE, { hosts: this.getHosts() });
    }
    registerSocket(host: Host, socket: Socket, port: number): void { this.sockets.set(this.socketKey(host, socket.getType(), port), socket); }
    unregisterSocket(host: Host, port: number): void { for (const type of ['TCP', 'UDP']) this.sockets.delete(this.socketKey(host, type, port)); }
    getSocketStates(host: Host): {type:string;local:string;remote:string;state:string}[] {
        const rows:{type:string;local:string;remote:string;state:string}[]=[];
        for(const socket of this.sockets.values())if(socket.getHost()===host){const local=socket.getLocalAddress()!,remote=socket.getRemoteAddress();rows.push({type:socket.getType(),local:`${local.ip}:${local.port}`,remote:remote?`${remote.ip}:${remote.port}`:'*',state:socket.getState()});}
        for(const conn of this.connections.values())if(conn.socket.getHost()===host&&conn.socket.getState()==='LISTENING')rows.push({type:'TCP',local:`${host.getIP()}:${conn.local}`,remote:`${conn.remote.ip}:${conn.remote.port}`,state:conn.closing?'CLOSING':conn.state.toUpperCase()});
        return rows;
    }
    cancelProbes(host: Host): void {for(const [id,probe] of this.probes)if(probe.host===host){this.probes.delete(id);probe.resolve({success:false,ip:'',error:'Abgebrochen'});}}
    sendARPReply(host: Host, senderIP: string, targetIP: string): void {
        const port=this.hostPort(host),packet=this.packet(port,targetIP,'ARP',{opcode:'reply',senderIP,senderMac:host.getMAC(),targetIP});
        packet.destMac='FF:FF:FF:FF:FF:FF';this.enqueue(port,packet);
    }
    getNATTable(router: Vermittlungsrechner) { return this.nat.getEntries(router, this.now); }
    private packet(port: Port, destIP: string, protocol: NetworkPacket['protocol'], payload: NetworkPacket['payload'], sourcePort = 0, destPort = 0): NetworkPacket {
        return { id: `pkt-${this.origin}-${++this.packetId}`, sourceIP: destIP === '127.0.0.1' && port.device instanceof Host ? '127.0.0.1' : port.iface.getIP(), destIP, sourceMac: port.iface.getMAC(), destMac: '',
            sourcePort, destPort, protocol, payload: structuredClone(payload), transport: protocol === 'ICMP' || protocol === 'ARP' ? undefined : protocol === 'UDP' || protocol === 'DNS' || protocol === 'DHCP' ? 'UDP' : 'TCP',
            ttl: 64, sourceColor: port.device instanceof Host ? port.device.getColor() : '#0ea5e9', progress: 0, directionToNode2: true };
    }
    private application(type: 'TCP' | 'UDP', src: number, dst: number): NetworkPacket['protocol'] {
        if (type === 'UDP') { if (src === 53 || dst === 53) return 'DNS'; if ([67, 68].includes(src) || [67, 68].includes(dst)) return 'DHCP'; return 'UDP'; }
        if (src === 80 || dst === 80) return 'HTTP'; if (src === 25 || dst === 25) return 'SMTP'; if (src === 110 || dst === 110) return 'POP3'; return 'TCP';
    }
    private transmit(port: Port, packet: NetworkPacket): void {
        if (packet.destIP === '127.0.0.1' || (port.device instanceof Host && packet.destIP === port.iface.getIP())) {
            packet.destMac = port.iface.getMAC(); this.log(port, packet, 'Gesendet'); this.loopback.push({ port, packet }); return;
        }
        if (packet.destIP === '255.255.255.255' || packet.destIP === getBroadcastAddress(port.iface.getIP(), port.iface.getSubnetMask())) {
            packet.destMac = 'FF:FF:FF:FF:FF:FF'; this.enqueue(port, packet); return;
        }
        let nextHop = packet.destIP;
        if (!sameNetwork(port.iface.getIP(), packet.destIP, port.iface.getSubnetMask())) {
            if (port.device instanceof Vermittlungsrechner) {
                const route = port.device.findRoute(packet.destIP);
                if (!route) return this.drop(port, packet, 'Keine Route');
                nextHop = route.gateway === '0.0.0.0' || !route.gateway ? packet.destIP : route.gateway;
            } else nextHop = port.iface.getGateway();
            if (!nextHop || !sameNetwork(port.iface.getIP(), nextHop, port.iface.getSubnetMask())) return this.drop(port, packet, 'Gateway fehlt oder liegt außerhalb des Subnetzes');
        }
        const cached = this.neighbors.get(port.iface)?.get(nextHop);
        if (cached && cached.expires > this.now) { packet.destMac = cached.mac; this.enqueue(port, packet); return; }
        const key = `${port.device.getId()}:${port.index}:${nextHop}`;
        let pending = this.pendingARP.get(key);
        if (!pending) { pending = { port, ip: nextHop, packets: [], attempts: 1, retryAt: this.now + 2000 }; this.pendingARP.set(key, pending); this.requestARP(port, nextHop); }
        if (pending.packets.length < 256) pending.packets.push(packet);
    }
    private enqueue(port: Port, packet: NetworkPacket): void {
        if (!port.iface.isConnected()) return this.drop(port, packet, 'Interface nicht verbunden');
        packet.frameId=`frame-${this.origin}-${++this.packetId}`;
        packet.sourceMac = port.iface.getMAC(); packet.progress = 0;
        port.iface.sendPacket(packet); this.log(port, packet, 'Gesendet');
    }
    private requestARP(port: Port, ip: string): void {
        const packet = this.packet(port, ip, 'ARP', { opcode: 'request', senderIP: port.iface.getIP(), senderMac: port.iface.getMAC(), targetIP: ip });
        packet.destMac = 'FF:FF:FF:FF:FF:FF'; this.enqueue(port, packet);
    }
    private receive(port: Port, packet: NetworkPacket): void {
        if (port.device instanceof Switch || port.device instanceof Modem) { port.device.receivePacket(packet, port.index); return; }
        const mac = packet.destMac.toUpperCase();
        if (mac !== port.iface.getMAC().toUpperCase() && mac !== 'FF:FF:FF:FF:FF:FF') return;
        this.log(port, packet, 'Empfangen');
        if (packet.protocol === 'ARP') {
            const data = packet.payload;
            if (!data || !['request', 'reply'].includes(data.opcode) || data.targetIP !== port.iface.getIP()) return;
            if (!this.neighbors.has(port.iface)) this.neighbors.set(port.iface, new Map());
            this.neighbors.get(port.iface)!.set(data.senderIP, { mac: data.senderMac, expires: this.now + 300000 });
            if (data.opcode === 'request') {
                const reply = this.packet(port, data.senderIP, 'ARP', { opcode: 'reply', senderIP: port.iface.getIP(), senderMac: port.iface.getMAC(), targetIP: data.senderIP });
                reply.destMac = data.senderMac; this.enqueue(port, reply);
            }
            const key = `${port.device.getId()}:${port.index}:${data.senderIP}`;
            const pending = this.pendingARP.get(key); this.pendingARP.delete(key);
            pending?.packets.forEach(p => this.transmit(port, p)); return;
        }
        if (port.device instanceof Vermittlungsrechner) {
            if (packet.protocol === 'RIP') {
                if (port.device.isRIPEnabled() && sameNetwork(packet.sourceIP, port.iface.getIP(), port.iface.getSubnetMask()) && Array.isArray(packet.payload?.routes)) {
                    for (const route of packet.payload.routes) port.device.learnRIP(route.network, route.subnetMask, packet.sourceIP, port.index, Math.min(16, route.metric + 1), this.now);
                }
                return;
            }
            this.nat.inbound(port.device, packet, port.index, this.now);
        }
        if (port.device instanceof Vermittlungsrechner && !port.device.isLocalIP(packet.destIP) && packet.destIP !== '255.255.255.255' && packet.destIP !== getBroadcastAddress(port.iface.getIP(),port.iface.getSubnetMask())) {
            const router = port.device;
            if (packet.destIP === '255.255.255.255' || mac === 'FF:FF:FF:FF:FF:FF') return;
            if (!router.isIPForwardingEnabled()) return this.drop(port, packet, 'IP-Weiterleitung deaktiviert');
            if (!router.checkFirewall(packet.sourceIP, packet.destIP, packet.transport || packet.protocol, packet.sourcePort, packet.destPort, 'inbound')) return this.drop(port, packet, 'Firewall (eingehend)');
            if ((packet.ttl ?? 64) <= 1) { this.icmpError(port, packet, 'time-exceeded'); return; }
            const route = router.findRoute(packet.destIP); const iface = route && router.getInterface(route.interfaceIndex);
            if (!route || !iface) { this.icmpError(port, packet, 'unreachable'); return this.drop(port, packet, 'Keine Route'); }
            if (!router.checkFirewall(packet.sourceIP, packet.destIP, packet.transport || packet.protocol, packet.sourcePort, packet.destPort, 'outbound')) return this.drop(port, packet, 'Firewall (ausgehend)');
            const forwarded = clonePacket(packet); forwarded.ttl = (packet.ttl ?? 64) - 1;
            if(!this.nat.outbound(router,forwarded,port.index,route.interfaceIndex,this.now))return this.drop(port,packet,'NAT-Portbereich erschöpft');
            this.transmit({ device: router, iface, index: route.interfaceIndex }, forwarded); return;
        }
        const local = (port.device instanceof Vermittlungsrechner && port.device.isLocalIP(packet.destIP)) || packet.destIP === port.iface.getIP() || packet.destIP === '127.0.0.1' || packet.destIP === '255.255.255.255' || packet.destIP === getBroadcastAddress(port.iface.getIP(), port.iface.getSubnetMask());
        if (!local) return;
        if(port.device instanceof Vermittlungsrechner && !port.device.checkFirewall(packet.sourceIP,packet.destIP,packet.transport||packet.protocol,packet.sourcePort,packet.destPort,'inbound'))return this.drop(port,packet,'Firewall (lokal)');
        if (port.device instanceof Host) {
            const type = packet.transport || packet.protocol;
            const remote = { ip: packet.sourceIP, port: packet.sourcePort };
            const established = type === 'TCP' && packet.tcp?.flags !== 'SYN' && this.connections.has(this.connKey(port.device, packet.destPort, remote)) || type === 'UDP' && (this.udpFlows.get(`${port.device.getId()}:${packet.destPort}:${remote.ip}:${remote.port}`) || 0) > this.now;
            if (!port.device.acceptsPacket(packet, established)) return this.drop(port, packet, 'Persönliche Firewall');
        }
        if (packet.protocol === 'ICMP') { this.receiveICMP(port, packet); return; }
        if (!(port.device instanceof Host || port.device instanceof Vermittlungsrechner)) return;
        const type = packet.transport || (['UDP', 'DNS', 'DHCP'].includes(packet.protocol) ? 'UDP' : 'TCP');
        const boundSocket = this.sockets.get(this.socketKey(port.device, type, packet.destPort));
        const boundIP = boundSocket?.getLocalAddress()?.ip;
        const broadcast=packet.destIP==='255.255.255.255'||packet.destIP===getBroadcastAddress(port.iface.getIP(),port.iface.getSubnetMask());
        const socket = boundIP === '0.0.0.0' || boundIP === packet.destIP || broadcast && boundIP === port.iface.getIP() ? boundSocket : undefined;
        if (type === 'TCP') { this.receiveTCP(port, packet, socket); return; }
        if (!socket || socket.getState() === 'CLOSED') return this.drop(port, packet, 'Port geschlossen');
        const remote = socket.getRemoteAddress();
        if (remote && (remote.ip !== packet.sourceIP || remote.port !== packet.sourcePort)) return;
        socket.receive({ data: packet.payload, source: { ip: packet.sourceIP, port: packet.sourcePort } });
    }
    private sendSocket(socket: Socket, payload: NetworkPacket['payload'], dest: SocketAddress): void {
        const host = socket.getHost(), local = socket.getLocalAddress(); if (!host || !local || !dest) return;
        let port = this.hostPort(host,dest.ip);
        if(host instanceof Vermittlungsrechner && local.ip!=='0.0.0.0' && local.ip!=='127.0.0.1'){const index=host.getInterfaces().findIndex(iface=>iface.getIP()===local.ip);if(index<0)return;port={device:host,iface:host.getInterface(index)!,index};}
        const packet = this.packet(port, dest.ip, this.application(socket.getType(), local.port, dest.port), payload, local.port, dest.port);
        if (socket.getType() === 'UDP' && local.ip !== '0.0.0.0') packet.sourceIP=local.ip;
        if (socket.getType() === 'UDP') this.udpFlows.set(`${host.getId()}:${local.port}:${dest.ip}:${dest.port}`, this.now + 120000);
        if (socket.getType() === 'TCP') {
            const conn = this.connections.get(this.connKey(host, local.port, dest));
            if (!conn || conn.state !== 'established' || conn.closing) { socket.triggerError(new Error('TCP-Verbindung nicht aufgebaut')); return; }
            port = this.hostPort(host, dest.ip);
            packet.sourceMac=port.iface.getMAC();
            packet.sourceIP=conn.localIP;
            packet.tcp = { flags: 'PSH ACK', seq: conn.seq, ack: conn.ack }; conn.seq = (conn.seq + this.length(payload)) >>> 0;
            this.track(conn, packet);
        }
        this.transmit(port, packet);
    }
    private length(payload: NetworkPacket['payload']): number { return payload instanceof Uint8Array ? payload.byteLength : new TextEncoder().encode(typeof payload === 'string' ? payload : JSON.stringify(payload)).length; }
    private control(port: Port, remote: SocketAddress, local: number, flags: string, conn?: Connection): NetworkPacket {
        const packet = this.packet(port, remote.ip, 'TCP', '', local, remote.port);
        if(conn)packet.sourceIP=conn.localIP;
        packet.tcp = { flags, seq: conn?.seq ?? 0, ack: conn?.ack ?? 0 }; return packet;
    }
    private track(conn: Connection, packet: NetworkPacket): void { conn.pending.set(packet.tcp!.seq, { packet: clonePacket(packet), retryAt: this.now + 3000, attempts: 1 }); }
    private connect(socket: Socket): void {
        const host = socket.getHost(), remote = socket.getRemoteAddress(), local = socket.getLocalAddress(); if (!host || !remote || !local) return;
        const port = this.hostPort(host,remote.ip);
        const conn: Connection = { socket, remote, local: local.port, localIP: remote.ip==='127.0.0.1'?'127.0.0.1':local.ip!=='0.0.0.0'?local.ip:port.iface.getIP(), state: 'syn-sent', seq: socket.getSequenceNumber(), ack: 0, pending: new Map() };
        this.connections.set(this.connKey(host, local.port, remote), conn);
        const packet = this.control(port, remote, local.port, 'SYN', conn); conn.seq = (conn.seq + 1) >>> 0;
        this.track(conn, packet); this.transmit(port, packet);
    }
    private receiveTCP(port: Port, packet: NetworkPacket, socket?: Socket): void {
        const host = port.device as SocketEndpoint, remote = { ip: packet.sourceIP, port: packet.sourcePort };
        const key = this.connKey(host, packet.destPort, remote); let conn = this.connections.get(key);
        socket = conn?.socket || socket;
        const tcp = packet.tcp; if (!tcp) return this.drop(port, packet, 'TCP-Header fehlt');
        if (tcp.flags.includes('RST')) { if (conn) { this.connections.delete(key); conn.socket.triggerDisconnect(remote); if (conn.socket.getState() !== 'LISTENING') conn.socket.triggerError(new Error('Verbindung abgelehnt')); if (conn.socket.getState() !== 'LISTENING') conn.socket.close(); } return; }
        if (!socket) { if (!tcp.flags.includes('FIN')) this.transmit(port, this.control(port, remote, packet.destPort, 'RST')); return; }
        if (tcp.flags === 'SYN') {
            if (socket.getState() !== 'LISTENING') return;
            if (!conn) { conn = { socket, remote, local: packet.destPort, localIP: packet.destIP, state: 'syn-received', seq: socket.getSequenceNumber(), ack: (tcp.seq + 1) >>> 0, pending: new Map() }; this.connections.set(key, conn); }
            const reply = this.control(port, remote, packet.destPort, 'SYN ACK', conn);
            if (!conn.pending.size) { this.track(conn, reply); conn.seq = (conn.seq + 1) >>> 0; }
            else reply.tcp!.seq = [...conn.pending.keys()][0];
            this.transmit(port, reply); return;
        }
        if (!conn) return this.drop(port, packet, 'Keine TCP-Verbindung');
        if (tcp.flags.includes('ACK')) for (const [seq, pending] of conn.pending) {
            const end = (seq + (pending.packet.tcp!.flags.includes('SYN') || pending.packet.tcp!.flags.includes('FIN') ? 1 : this.length(pending.packet.payload))) >>> 0;
            if (end === tcp.ack || ((tcp.ack - end) >>> 0) < 0x80000000) conn.pending.delete(seq);
        }
        if (tcp.flags === 'SYN ACK' && conn.state === 'established') { this.transmit(port, this.control(port, remote, packet.destPort, 'ACK', conn)); return; }
        if (tcp.flags === 'SYN ACK' && conn.state === 'syn-sent') {
            if (tcp.ack !== conn.seq) return;
            conn.ack = (tcp.seq + 1) >>> 0; conn.state = 'established';
            this.transmit(port, this.control(port, remote, packet.destPort, 'ACK', conn));
            socket.completeConnection(); return;
        }
        if (tcp.flags.includes('ACK') && conn.state === 'syn-received' && tcp.ack === conn.seq) { conn.state = 'established'; socket.triggerAccept(remote); if (tcp.flags === 'ACK') return; }
        if (tcp.flags.includes('FIN')) {
            // A FIN after missing data must wait for its sequence position, just like data.
            if(tcp.seq === conn.ack && !conn.finReceived){
                conn.ack=(conn.ack+1)>>>0;conn.finReceived=true;conn.closing=true;conn.expires=this.now+30000;
                socket.triggerDisconnect(remote);if(socket.getState()!=='LISTENING')socket.close();
            }
            this.transmit(port,this.control(port,remote,packet.destPort,'ACK',conn));
            this.finishConnection(port,conn);return;
        }
        this.finishConnection(port,conn);
        if (tcp.flags.includes('PSH') && conn.state === 'established') {
            if (tcp.seq === conn.ack) { conn.ack = (conn.ack + this.length(packet.payload)) >>> 0;
                this.transmit(port, this.control(port, remote, packet.destPort, 'ACK', conn));
                socket.receive({ data: packet.payload, source: remote });
            } else this.transmit(port, this.control(port, remote, packet.destPort, 'ACK', conn));
        }
    }
    private finishConnection(port: Port, conn: Connection): void {
        if(!conn.closing || conn.pending.size)return;
        if(conn.finSent === undefined){
            const fin=this.control(port,conn.remote,conn.local,'FIN ACK',conn);conn.finSent=conn.seq;conn.seq=(conn.seq+1)>>>0;
            this.track(conn,fin);this.transmit(port,fin);
        } else if(conn.finReceived)conn.expires=this.now+10000; // Answer duplicate FINs during TIME_WAIT.
    }
    private closeSocket(socket: Socket, host: SocketEndpoint, local: number): void {
        const key=this.socketKey(host,socket.getType(),local);if(this.sockets.get(key)===socket)this.sockets.delete(key);
        for(const [key,conn] of this.connections)if(conn.socket===socket){
            if(conn.state!=='established'){this.connections.delete(key);continue;}
            conn.closing=true;conn.expires=this.now+30000;this.finishConnection(this.hostPort(host, conn.remote.ip),conn);
        }
    }
    async probe(host: Host, destIP: string, ttl = 64): Promise<ProbeResult> {
        if (this.disposed || !this.nodes.includes(host)) return { success: false, ip: '', error: 'Gerät ist nicht Teil eines aktiven Projekts' };
        const port = this.hostPort(host), id = `icmp-${this.origin}-${++this.packetId}`;
        return new Promise(resolve => {
            this.probes.set(id, { resolve, host, started: this.now, deadline: this.now + 15000 });
            const packet = this.packet(port, destIP, 'ICMP', { type: 'echo-request', id }); packet.ttl = ttl;
            this.transmit(port, packet);
        });
    }
    private icmpError(port: Port, original: NetworkPacket, type: 'time-exceeded' | 'unreachable'): void {
        if (original.protocol === 'ICMP' && original.payload.type !== 'echo-request') return;
        this.transmit(port, this.packet(port, original.sourceIP, 'ICMP', { type, id: original.payload?.id }));
    }
    private receiveICMP(port: Port, packet: NetworkPacket): void {
        const data = packet.payload;
        if (data?.type === 'echo-request') {
            const reply = this.packet(port, packet.sourceIP, 'ICMP', { type: 'echo-reply', id: data.id });
            if (packet.destIP === '127.0.0.1') reply.sourceIP = '127.0.0.1'; this.transmit(port, reply); return;
        }
        const probe = this.probes.get(data?.id);
        if (!probe || probe.host !== port.device) return;
        this.probes.delete(data.id); probe.resolve({ success: data.type === 'echo-reply', exceeded: data.type === 'time-exceeded', ip: packet.sourceIP,
            time: Math.round(this.now - probe.started), ttl: packet.ttl, error: data.type === 'unreachable' ? 'Ziel nicht erreichbar' : undefined });
    }
    getARPTable(host: Host): { ip: string; mac: string }[] { return [...(this.neighbors.get(host.getNetworkInterface()) ?? [])].filter(([, n]) => n.expires > this.now).map(([ip, n]) => ({ ip, mac: n.mac })); }
    removeARPEntry(host: Host, ip: string): void { this.neighbors.get(host.getNetworkInterface())?.delete(ip); }
    private tick(delta: number): void {
        this.now += delta;
        for(const node of this.nodes)if(node instanceof Vermittlungsrechner&&!this.routerServices.has(node)){
            const socket=new Socket('TCP',node);
            if(socket.bind(80)&&socket.listen()){
                socket.onData(message=>{if(message.source&&typeof message.data==='string')socket.send(routerResponse(node,message.data),message.source);});
                this.routerServices.set(node,socket);
            }
        }
        this.nodes.forEach(n => { if (n instanceof Vermittlungsrechner) n.expireRIP(this.now); });
        if (this.now >= this.nextRIP) { this.nextRIP = this.now + 30000; this.advertiseRIP(); }
        this.nodes.forEach(node => { if (node instanceof Modem) node.flushIncoming(); });
        for (const cable of this.cables) cable.tick(delta / 16);
        const local = this.loopback.splice(0); local.forEach(({ port, packet }) => this.receive(port, packet));
        for (const [key, pending] of this.pendingARP) if (this.now >= pending.retryAt) {
            if (pending.attempts >= 3) { this.pendingARP.delete(key); pending.packets.forEach(p => this.drop(pending.port, p, 'ARP-Zeitüberschreitung')); }
            else { pending.attempts++; pending.retryAt = this.now + 2000; this.requestARP(pending.port, pending.ip); }
        }
        for(const [key,conn] of this.connections)if(conn.expires!==undefined && this.now>=conn.expires)this.connections.delete(key);
        for (const [key, conn] of this.connections) for (const [, pending] of conn.pending) if (this.now >= pending.retryAt) {
            if (pending.attempts >= 4) { this.connections.delete(key); conn.pending.clear(); conn.socket.triggerDisconnect(conn.remote); if (conn.socket.getState() !== 'LISTENING') conn.socket.triggerError(new Error('TCP-Zeitüberschreitung'));  if (conn.socket.getState() !== 'LISTENING') conn.socket.close(); break; }
            const host = conn.socket.getHost(); if (!host) continue;
            pending.attempts++; pending.retryAt = this.now + 3000; this.transmit(this.hostPort(host, conn.remote.ip), clonePacket(pending.packet));
        }
        for (const [id, probe] of this.probes) if (this.now >= probe.deadline) { this.probes.delete(id); probe.resolve({ success: false, ip: '', error: 'Zeitüberschreitung der Anforderung.' }); }
    }
    private advertiseRIP(): void {
        for (const node of this.nodes) if (node instanceof Vermittlungsrechner && node.isRIPEnabled()) {
            node.getInterfaces().forEach((iface, index) => {
                if (!iface.isConnected()) return;
                const routes = node.getRoutingTable().map(r => ({ network: r.network, subnetMask: r.subnetMask,
                    metric: r.gateway !== '0.0.0.0' && r.interfaceIndex === index ? 16 : Math.min(16, r.metric + (r.gateway === '0.0.0.0' ? 1 : 0)) }));
                const port = { device: node, iface, index }, packet = this.packet(port, '224.0.0.9', 'RIP', { routes }, 520, 520);
                packet.transport = 'UDP'; packet.destMac = 'FF:FF:FF:FF:FF:FF'; packet.ttl = 1; this.enqueue(port, packet);
            });
        }
    }
    private log(port: Port, packet: NetworkPacket, action: string): void {
        this.journal.addEntry({ sourceIP: packet.sourceIP, destIP: packet.destIP, sourceMAC: packet.sourceMac, destMAC: packet.destMac,
            sourcePort: packet.sourcePort, destPort: packet.destPort, protocol: packet.protocol, transport: packet.transport || packet.protocol,
            size: this.length(packet.payload), info: `${action}: ${packet.tcp?.flags || packet.payload?.type || packet.payload?.opcode || packet.protocol}`,
            payload: packet.payload, ttl: packet.ttl, tcp: packet.tcp, relatedDeviceId: port.device.getId(), color: packet.sourceColor });
    }
    private drop(port: Port, packet: NetworkPacket, reason: string): void { this.log(port, packet, `Verworfen (${reason})`); this.events.emit(Events.PACKET_DROPPED, { packet, reason }); }
    clear(): void {
        const sockets = [...this.sockets.values()]; this.sockets.clear(); this.connections.clear(); sockets.forEach(s => s.close());
        this.routerServices.clear();
        this.udpFlows.clear(); this.nat.clear(); this.nextRIP = 0;
        this.nodes.forEach(n => { if (n instanceof Vermittlungsrechner) n.clearDynamicRoutes(); });
        this.neighbors.clear(); this.pendingARP.clear(); this.loopback = [];
        this.probes.forEach(p => p.resolve({ success: false, ip: '', error: 'Simulation beendet' })); this.probes.clear();
        this.ports().forEach(p => p.iface.clearQueue()); this.cables.forEach(c => c.clearTransit());
        this.nodes.forEach(n => { if (n instanceof Switch) n.clearMACTable(); });
    }
}
export const networkStack = new NetworkStack();
