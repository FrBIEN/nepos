import type { ApplicationContext } from './ApplicationContext';
import type { ProjectWorkspace } from './ProjectController';
import { Host } from '../hardware/Host';
import { DHCPClient } from '../apps/DHCP';
import type { SimulationMode } from '../core/SimulationEngine';
export interface SimulationDependencies {
    context: ApplicationContext;
    workspace: Pick<ProjectWorkspace, 'nodes' | 'cables'>;
    windows: {
        prepareClose(): Promise<boolean>;
        closeAll(): void;
    };
    canChange: () => boolean;
    onMode: (mode: SimulationMode) => void;
    onPlayback: () => void;
    onHost: (host: Host) => void;
}
/** Coordinates mode transitions and DHCP; presentation is delegated to the view. */
export class SimulationController {
    private mode: SimulationMode = 'design';
    private changing = false;
    private generation = 0;
    constructor(private deps: SimulationDependencies) { }
    get isSimulation(): boolean { return this.mode === 'simulation'; }
    async change(mode: SimulationMode): Promise<boolean> {
        if (this.changing || !this.deps.canChange())
            return false;
        if (this.mode === mode)
            return true;
        this.changing = true;
        const { context, workspace, windows } = this.deps;
        try {
            if (mode === 'design' && !await windows.prepareClose())
                return false;
            if (!this.deps.canChange())
                return false;
            ++this.generation;
            this.mode = mode;
            if (mode === 'design') {
                context.services.stop();
                context.simulation.switchToDesignMode();
                windows.closeAll();
                context.network.clear();
                context.packets.clear();
            }
            else {
                context.network.updateTopology(workspace.nodes(), workspace.cables());
                for (const node of workspace.nodes())
                    if (node instanceof Host && node.getNetworkInterface().isDHCPEnabled())
                        node.getNetworkInterface().setIP('0.0.0.0');
                context.simulation.switchToSimulationMode();
                context.simulation.start();
                context.services.start();
                void this.requestDHCP(this.generation);
            }
            this.deps.onMode(mode);
            return true;
        }
        finally {
            this.changing = false;
        }
    }
    togglePause(): void {
        if (!this.isSimulation)
            return;
        const engine = this.deps.context.simulation;
        if (engine.getState() === 'running')
            engine.pause();
        else if (engine.getState() === 'paused')
            engine.resume();
        this.deps.onPlayback();
    }
    private async requestDHCP(generation: number): Promise<void> {
        await Promise.all(this.deps.workspace.nodes().filter((node): node is Host => node instanceof Host).map(async (host) => {
            const iface = host.getNetworkInterface();
            if (!iface.isDHCPEnabled() || iface.getIP() !== '0.0.0.0')
                return;
            try {
                const config = await new DHCPClient(iface.getMAC(), host.getName(), host).requestIP();
                if (generation !== this.generation || !this.isSimulation || !this.deps.workspace.nodes().includes(host))
                    return;
                iface.setIP(config.ip);
                iface.setSubnetMask(config.subnetMask);
                iface.setGateway(config.router || '');
                iface.setDNS(config.dns?.[0] || '');
                this.deps.onHost(host);
            }
            catch (error) {
                if (generation === this.generation && this.isSimulation)
                    console.warn('DHCP für ' + host.getName() + ':', error);
            }
        }));
    }
    dispose(): void {
        ++this.generation;
        this.deps.context.services.stop();
        this.deps.context.simulation.switchToDesignMode();
        this.mode = 'design';
    }
}
