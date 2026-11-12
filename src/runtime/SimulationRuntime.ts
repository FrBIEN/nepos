import { EventBus, Events } from '../core/EventBus';
import { SimulationEngine } from '../core/SimulationEngine';
import { NetworkStack } from '../network/NetworkStack';
import { PacketJournal } from '../network/PacketJournal';
import { HostServerManager } from '../apps/WebServer';
import { HostDhcpServerManager, PendingDHCPClientManager } from '../apps/DHCP';
import { HostDnsServerManager } from '../apps/DNS';
import { HostEchoServerManager } from '../apps/EchoServer';
import { HostEmailServerManager } from '../apps/email/EmailServer';
import { HostEmailClientManager } from '../apps/email/EmailClient';
import { HostFileSystemManager } from '../apps/FileSystem';
import { PeerToPeerManager } from '../apps/PeerToPeer';
import { createEditorSessions } from '../apps/EditorSessions';
import { createServices } from '../apps/Services';
import { RuntimeIdentifiers } from './RuntimeIdentifiers';
import { Operations } from './Operations';
import type { RuntimeDependencies } from './RuntimeDependencies';

/** One project owns a clock, event bus, protocol stack, services and pending operations. */
export class SimulationRuntime implements RuntimeDependencies {
    readonly events = new EventBus();
    readonly simulation = new SimulationEngine(this.events);
    readonly journal = new PacketJournal(this.events, () => this.simulation.getSimulationTime());
    readonly network = new NetworkStack(this.events, this.simulation, this.journal);
    readonly ids = new RuntimeIdentifiers();
    readonly operations = new Operations();
    readonly hostServerManager: HostServerManager = new HostServerManager(this);
    readonly hostDhcpServerManager: HostDhcpServerManager = new HostDhcpServerManager(this);
    readonly pendingDHCPClientManager = new PendingDHCPClientManager();
    readonly hostDnsServerManager: HostDnsServerManager = new HostDnsServerManager(this);
    readonly hostEchoServerManager: HostEchoServerManager = new HostEchoServerManager(this);
    readonly hostEmailServerManager: HostEmailServerManager = new HostEmailServerManager(this);
    readonly hostEmailClientManager: HostEmailClientManager = new HostEmailClientManager(this);
    readonly hostFileSystemManager: HostFileSystemManager = new HostFileSystemManager(this);
    readonly peerToPeerManager: PeerToPeerManager = new PeerToPeerManager(this);
    readonly editorSessions = createEditorSessions(this.events);
    readonly services = createServices(this);
    private disposed = false;
    constructor() { this.events.on(Events.SIMULATION_STOP, () => { this.operations.cancelAll(); this.pendingDHCPClientManager.cancelAll(); }); }
    /** Invalidate asynchronous work before the old project can affect a replacement. */
    stop(): void { this.operations.cancelAll(); this.services.stop(); this.simulation.reset(); this.network.clear(); }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.stop(); this.services.restore(); this.hostEmailServerManager.dispose();
        this.network.dispose(); this.operations.dispose(); this.simulation.dispose(); this.journal.clear(); this.events.clear();
    }
}
