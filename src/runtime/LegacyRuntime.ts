import { eventBus } from '../core/EventBus';
import { simulationEngine } from '../core/SimulationEngine';
import { networkStack } from '../network/NetworkStack';
import { packetJournal } from '../network/PacketJournal';
import { hostServerManager } from '../apps/WebServer';
import { hostDhcpServerManager } from '../apps/DHCP';
import { pendingDHCPClientManager } from '../apps/DHCP';
import { hostDnsServerManager } from '../apps/DNS';
import { hostEchoServerManager } from '../apps/EchoServer';
import { hostEmailServerManager } from '../apps/email/EmailServer';
import { hostEmailClientManager } from '../apps/email/EmailClient';
import { hostFileSystemManager } from '../apps/FileSystem';
import { peerToPeerManager } from '../apps/PeerToPeer';
import { editorSessions } from '../apps/EditorSessions';
import type { RuntimeDependencies } from './RuntimeDependencies';
import { RuntimeIdentifiers } from './RuntimeIdentifiers';
import { Operations } from './Operations';
import { generateId, setIdCounter } from '../core/types';
const ids = new RuntimeIdentifiers();
ids.generateId = generateId; ids.setIdCounter = setIdCounter;
/** Compatibility for standalone examples and existing protocol tests. Production owns a SimulationRuntime. */
export const legacyRuntime: RuntimeDependencies = {
    get events() { return eventBus; },
    get simulation() { return simulationEngine; },
    get network() { return networkStack; },
    get journal() { return packetJournal; },
    get hostServerManager() { return hostServerManager; },
    get hostDhcpServerManager() { return hostDhcpServerManager; },
    get pendingDHCPClientManager() { return pendingDHCPClientManager; },
    get hostDnsServerManager() { return hostDnsServerManager; },
    get hostEchoServerManager() { return hostEchoServerManager; },
    get hostEmailServerManager() { return hostEmailServerManager; },
    get hostEmailClientManager() { return hostEmailClientManager; },
    get hostFileSystemManager() { return hostFileSystemManager; },
    get peerToPeerManager() { return peerToPeerManager; },
    get editorSessions() { return editorSessions; },
    ids, operations: new Operations()
};
