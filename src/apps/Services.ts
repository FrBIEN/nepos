import { assertRuntimeOwner } from '../runtime/assertRuntimeOwner';
import { legacyRuntime } from '../runtime/LegacyRuntime';
import type { RuntimeDependencies } from '../runtime/RuntimeDependencies';
import { Knoten } from '../hardware/Knoten';
import { Vermittlungsrechner } from '../hardware/Vermittlungsrechner';
import { Host } from '../hardware/Host';
import type { ServiceState } from '../scenario/ScenarioManager';

import { validateScenario } from '../scenario/ScenarioValidation';

/** One lifecycle and persistence boundary for all applications in a project. */
export function createServices(runtime?: RuntimeDependencies) {
    const dependencies = () => runtime ?? legacyRuntime;
    return {
    snapshot(nodes: Knoten[]): ServiceState {
        nodes.forEach(node => assertRuntimeOwner(node, dependencies()));
        const hosts=nodes.filter((n):n is Host=>n instanceof Host);
        const ids = new Set(nodes.map(h => h.getId()));
        const state: ServiceState = { dhcpServers: dependencies().hostDhcpServerManager.getServiceState(), dnsServers: dependencies().hostDnsServerManager.getServiceState(),
            webServers: dependencies().hostServerManager.getServiceState(), echoServers: dependencies().hostEchoServerManager.getServiceState(),
            emailServers: dependencies().hostEmailServerManager.getServiceState(), emailClients: dependencies().hostEmailClientManager.getServiceState(),
            fileSystems: dependencies().hostFileSystemManager.getServiceState(), peerToPeer: dependencies().peerToPeerManager.getServiceState(), editorSessions: [...dependencies().editorSessions.sessions.values()],
            hostStates: hosts.map(h => ({ hostId: h.getId(), installedApps: h.getInstalledApps() })) };
        for (const key of Object.keys(state) as (keyof ServiceState)[]) { (state as unknown as Record<string,unknown>)[key] = state[key]?.filter(s => ids.has(s.hostId)); }
        return state;
    },
    restore(state: Partial<ServiceState> = {}, nodes: Knoten[] = []): void {
        nodes.forEach(node => assertRuntimeOwner(node, dependencies()));
        const hosts=nodes.filter((n):n is Host=>n instanceof Host);
        const endpoints=nodes.filter((n):n is Host|Vermittlungsrechner=>n instanceof Host||n instanceof Vermittlungsrechner);
        dependencies().operations.cancelAll();
        dependencies().pendingDHCPClientManager.cancelAll();
        dependencies().hostDhcpServerManager.restoreServiceState(state.dhcpServers || [], endpoints);
        dependencies().hostDnsServerManager.restoreServiceState(state.dnsServers || [], hosts);
        dependencies().hostFileSystemManager.restoreServiceState(state.fileSystems || [], hosts);
        dependencies().hostServerManager.restoreServiceState(state.webServers || [], hosts);
        dependencies().hostEchoServerManager.restoreServiceState(state.echoServers || [], hosts);
        dependencies().hostEmailServerManager.restoreServiceState(state.emailServers || [], hosts);
        dependencies().hostEmailClientManager.restoreServiceState(state.emailClients || [], hosts);
        dependencies().peerToPeerManager.restoreServiceState(state.peerToPeer || [], hosts);
        state.hostStates?.forEach(s => hosts.find(h => h.getId() === s.hostId)?.setInstalledApps(s.installedApps));
        dependencies().editorSessions.restore(state.editorSessions);
    },
    /** Roll back all managers if a later restore step fails. The canvas is still untouched. */
    replace(state: Partial<ServiceState>, nodes: Knoten[], previousNodes: Knoten[]): void {
        validateScenario({version:'1.0',name:'Dienstwiederherstellung',nodes:nodes.map(node=>node.toJSON()),cables:[],serviceState:state});
        const previous = structuredClone(this.snapshot(previousNodes));
        dependencies().operations.cancelAll();
        dependencies().network.clear();
        dependencies().simulation.reset();
        try { this.restore(state, nodes); }
        catch (error) { this.restore(previous, previousNodes); throw error; }
    },
    stop(): void {
        dependencies().operations.cancelAll();
        dependencies().pendingDHCPClientManager.cancelAll(); dependencies().hostDhcpServerManager.stopAllAndRemember();
        dependencies().hostDnsServerManager.stopAll(); dependencies().hostServerManager.stopAll(); dependencies().hostEchoServerManager.stopAll();
        dependencies().hostEmailServerManager.stopAll(); dependencies().peerToPeerManager.stopAll();
    },
    start(): void {
        dependencies().hostDhcpServerManager.restartPrevious(); dependencies().hostDnsServerManager.restartServers();
        dependencies().hostServerManager.restartServers(); dependencies().hostEchoServerManager.restartServers(); dependencies().hostEmailServerManager.restartServers(); dependencies().peerToPeerManager.restart();
    }
    };
}
export const services = createServices();
