import { ApplicationEvents } from './ApplicationEvents';
import { ScenarioManager } from '../scenario/ScenarioManager';
import { ProjectStore, type ProjectStorage } from '../scenario/ProjectStore';
import { SimulationRuntime } from '../runtime/SimulationRuntime';
import { PacketLog } from '../ui/PacketLog';

/** Explicit application dependencies, owned by one project runtime. */
export interface ApplicationContext extends Pick<SimulationRuntime,
    'simulation' | 'network' | 'services' | 'hostServerManager' | 'hostDhcpServerManager' | 'hostDnsServerManager' |
    'hostEchoServerManager' | 'hostEmailServerManager' | 'hostEmailClientManager' | 'hostFileSystemManager' | 'peerToPeerManager' | 'editorSessions'> {
    runtime: SimulationRuntime;
    events: ApplicationEvents;
    scenarios: ScenarioManager;
    store: ProjectStore;
    packets: PacketLog;
}
export function createApplicationContext(storage: ProjectStorage = localStorage): ApplicationContext {
    const runtime = new SimulationRuntime();
    return { runtime, scenarios: new ScenarioManager(runtime), store: new ProjectStore(storage), events: new ApplicationEvents(runtime.events),
        simulation: runtime.simulation, network: runtime.network, packets: new PacketLog(runtime.journal, runtime.events), services: runtime.services,
        hostServerManager: runtime.hostServerManager, hostDhcpServerManager: runtime.hostDhcpServerManager, hostDnsServerManager: runtime.hostDnsServerManager,
        hostEchoServerManager: runtime.hostEchoServerManager, hostEmailServerManager: runtime.hostEmailServerManager, hostEmailClientManager: runtime.hostEmailClientManager,
        hostFileSystemManager: runtime.hostFileSystemManager, peerToPeerManager: runtime.peerToPeerManager, editorSessions: runtime.editorSessions };
}
