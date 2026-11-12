import type { HostConfig } from '../hardware/Host';
import type { SwitchConfig } from '../hardware/Switch';
import type { VermittlungsrechnerConfig } from '../hardware/Vermittlungsrechner';
import type { ModemConfig } from '../hardware/Modem';
import type { KabelConfig } from '../hardware/Kabel';
import type { WebFile } from '../apps/WebServer';
import type { DHCPPoolConfig } from '../apps/DHCP';
import type { EditorSession } from '../apps/EditorSessions';
export interface DocElementData {
    id: string;
    type: 'textbox' | 'label' | 'rectangle';
    position: {
        x: number;
        y: number;
    };
    text: string;
    width: number;
    height: number;
    color: string;
}
export interface ServiceState {
    editorSessions?: EditorSession[];
    dhcpServers: {
        hostId: string;
        interfaceIndex?: number;
        running: boolean;
        config?: DHCPPoolConfig;
        reservations?: {
            mac: string;
            ip: string;
        }[];
    }[];
    dnsServers?: {
        hostId: string;
        running: boolean;
        records: {
            name: string;
            type: number; // DNSRecordType
            ttl: number;
            value: string;
        }[];
    }[];
    webServers?: {
        hostId: string;
        files: WebFile[];
        port?: number;
        running: boolean;
    }[];
    echoServers?: {
        hostId: string;
        port: number;
        running: boolean;
    }[];
    emailServers?: {
        hostId: string;
        serverState: object;
        running: boolean;
    }[];
    emailClients?: {
        hostId: string;
        clientState: object;
    }[];
    fileSystems?: {
        hostId: string;
        fsState: any;
    }[];
    peerToPeer?: {
        hostId: string;
        running: boolean;
        shares: string[];
        peers: {
            ip: string;
            port: number;
        }[];
    }[];
    hostStates?: {
        hostId: string;
        installedApps: string[];
    }[];
}
export interface ScenarioData {
    version: string;
    name: string;
    description?: string;
    createdAt: string;
    nodes: (HostConfig | SwitchConfig | VermittlungsrechnerConfig | ModemConfig)[];
    cables: KabelConfig[];
    docElements?: DocElementData[];
    serviceState?: ServiceState;
}
