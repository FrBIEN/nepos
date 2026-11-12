import { NetworkPacket } from '../simulation/NetworkPacket';
import { Vermittlungsrechner } from '../hardware/Vermittlungsrechner';

export interface NATEntry {
    protocol: string; insideIP: string; insidePort: number; outsidePort: number;
    remoteIP: string; remotePort: number; expires: number; icmpId?: string;
}
/** Stateful address/port translation; replies must match the remote endpoint. */
export class NAT {
    private entries = new Map<string, NATEntry[]>();
    private nextPort = 40000;
    clear(): void { this.entries.clear(); }
    getEntries(router: Vermittlungsrechner, now: number): NATEntry[] {
        const live = (this.entries.get(router.getId()) ?? []).filter(e => e.expires > now);
        this.entries.set(router.getId(), live); return live.map(e => ({ ...e }));
    }
    inbound(router: Vermittlungsrechner, packet: NetworkPacket, ingress: number, now: number): boolean {
        if (!router.isNATEnabled() || ingress !== router.getWANInterface() || packet.destIP !== router.getInterface(ingress)?.getIP()) return false;
        const entries = this.getEntries(router, now), protocol = packet.transport || packet.protocol;
        const match = entries.find(e => e.protocol === protocol && e.remoteIP === packet.sourceIP && e.remotePort === packet.sourcePort &&
            (protocol === 'ICMP' ? e.icmpId === packet.payload?.id : e.outsidePort === packet.destPort));
        if (match) { packet.destIP = match.insideIP; packet.destPort = match.insidePort; match.expires = now + 120000; this.entries.set(router.getId(), entries); return true; }
        const forward = router.getPortForwards().find(f => f.protocol.toUpperCase() === protocol && f.externalPort === packet.destPort);
        if (!forward) return false;
        entries.push({ protocol, insideIP: forward.internalIP, insidePort: forward.internalPort, outsidePort: forward.externalPort,
            remoteIP: packet.sourceIP, remotePort: packet.sourcePort, expires: now + 120000 });
        this.entries.set(router.getId(), entries); packet.destIP = forward.internalIP; packet.destPort = forward.internalPort; return true;
    }
    outbound(router: Vermittlungsrechner, packet: NetworkPacket, ingress: number, egress: number, now: number): boolean {
        if (!router.isNATEnabled() || egress !== router.getWANInterface() || ingress === egress) return true;
        const entries = this.getEntries(router, now), protocol = packet.transport || packet.protocol;
        let match = entries.find(e => e.protocol === protocol && e.insideIP === packet.sourceIP && e.insidePort === packet.sourcePort &&
            e.remoteIP === packet.destIP && e.remotePort === packet.destPort && (protocol !== 'ICMP' || e.icmpId === packet.payload?.id));
        if (!match) {
            let external = 0;
            if (protocol !== 'ICMP') {
                if(entries.filter(e=>e.protocol===protocol).length+router.getPortForwards().filter(f=>f.protocol.toUpperCase()===protocol).length>=20001)return false;
                do { external = this.nextPort++; if (this.nextPort > 60000) this.nextPort = 40000; }
                while (entries.some(e => e.protocol === protocol && e.outsidePort === external) || router.getPortForwards().some(f => f.externalPort === external && f.protocol.toUpperCase() === protocol));
            }
            match = { protocol, insideIP: packet.sourceIP, insidePort: packet.sourcePort, outsidePort: external, remoteIP: packet.destIP,
                remotePort: packet.destPort, expires: now + 120000, icmpId: protocol === 'ICMP' ? packet.payload?.id : undefined }; entries.push(match);
        }
        match.expires = now + 120000; this.entries.set(router.getId(), entries);
        packet.sourceIP = router.getInterface(egress)!.getIP(); packet.sourcePort = match.outsidePort; return true;
    }
}
