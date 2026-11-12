/**
 * NetworkPacket represents a data packet traveling through the network.
 * It carries both logic payload and visualization state.
 */
export interface NetworkPacket {
    // Unique ID for tracking
    id: string;
    frameId?: string;

    // Logical Addressing
    sourceMac: string;
    destMac: string;
    sourceIP: string;

    destIP: string;
    sourcePort: number;
    destPort: number;

    // Visualization Properties
    sourceColor: string; // The color of the device that created this packet
    color?: string; // Optional override color for packet (e.g. broadcast or ping reply)
    protocol: 'TCP' | 'UDP' | 'ICMP' | 'ARP' | 'DHCP' | 'HTTP' | 'DNS' | 'SMTP' | 'POP3' | 'RIP';

    transport?: 'TCP' | 'UDP';
    ttl?: number;
    tcp?: { flags: string; seq: number; ack: number };

    // Payload (Application Layer Data)
    payload: any;

    // Simulation State
    // "progress" tracks traversal (0 to 100).
    // Used for smooth visualization on cables.
    progress: number;

    // Direction on the cable (needed to know which node is "next")
    // true = node1 -> node2
    // false = node2 -> node1
    directionToNode2: boolean;
}

export function clonePacket(packet: NetworkPacket): NetworkPacket {
    return {
        ...packet,
        tcp: packet.tcp ? { ...packet.tcp } : undefined,
        payload: structuredClone(packet.payload)
    };
}
