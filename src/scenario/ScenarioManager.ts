import { legacyRuntime } from '../runtime/LegacyRuntime';
import type { RuntimeDependencies } from '../runtime/RuntimeDependencies';
// Scenario Manager - Save/Load network configurations

import { validateScenario } from './ScenarioValidation';
import { Knoten } from '../hardware/Knoten';
import { Host, HostConfig } from '../hardware/Host';
import { Switch, SwitchConfig } from '../hardware/Switch';
import { Vermittlungsrechner, VermittlungsrechnerConfig } from '../hardware/Vermittlungsrechner';
import { Modem, ModemConfig } from '../hardware/Modem';
import { Kabel, KabelConfig } from '../hardware/Kabel';
import { Events } from '../core/EventBus';

import type { ScenarioData, ServiceState } from './ScenarioTypes';
export type { ScenarioData, ServiceState, DocElementData } from './ScenarioTypes';

export class ScenarioManager {
    constructor(private runtime: RuntimeDependencies = legacyRuntime) {}
    private currentScenario: ScenarioData | null = null;

    /**
     * Creates a new empty scenario
     */
    newScenario(name: string = 'Untitled'): ScenarioData {
        this.currentScenario = {
            version: '1.0',
            name,
            createdAt: new Date().toISOString(),
            nodes: [],
            cables: [],
        };
        this.runtime.events.emit(Events.SCENARIO_NEW, { scenario: this.currentScenario });
        return this.currentScenario;
    }

    /**
     * Exports current network to scenario data
     */
    exportScenario(
        nodes: Knoten[],
        cables: Kabel[],
        name: string = 'Exported Scenario',
        serviceState?: ServiceState
    ): ScenarioData {
        const nodeConfigs: (HostConfig | SwitchConfig | VermittlungsrechnerConfig | ModemConfig)[] = [];

        for (const node of nodes) {
            if (node instanceof Host) {
                nodeConfigs.push(node.toJSON());
            } else if (node instanceof Switch) {
                nodeConfigs.push(node.toJSON());
            } else if (node instanceof Vermittlungsrechner) {
                nodeConfigs.push(node.toJSON());
            } else if (node instanceof Modem) {
                nodeConfigs.push(node.toJSON() as ModemConfig);
            }
        }

        const cableConfigs: KabelConfig[] = [];
        for (const cable of cables) {
            const config = cable.toJSON();
            if (config) {
                cableConfigs.push(config);
            }
        }

        const result: ScenarioData = {
            version: '1.0',
            name,
            createdAt: new Date().toISOString(),
            nodes: nodeConfigs,
            cables: cableConfigs,
        };

        if (serviceState) {
            result.serviceState = serviceState;
        }

        return result;
    }

    /**
     * Imports scenario data and creates nodes and cables
     */
    importScenario(data: ScenarioData, commit = true): {
        nodes: Knoten[];
        cables: Kabel[];
    } {
        validateScenario(data);
        const nodes: Knoten[] = [];
        const nodeMap = new Map<string, Knoten>();

        // Find max ID to set counter
        let maxId = 0;
        const checkId = (id?: string) => {
            const idMatch = id?.match(/node-(\d+)/);
            if (idMatch) {
                maxId = Math.max(maxId, parseInt(idMatch[1], 10));
            }
        };

        data.nodes.forEach(node => checkId(node.id));
        data.cables.forEach(cable => checkId(cable.id));

        this.runtime.ids.setIdCounter(maxId + 1);

        // Create nodes
        for (const nodeConfig of data.nodes) {
            let node: Knoten;

            switch (nodeConfig.type) {
                case 'rechner':
                case 'notebook':
                    node = Host.fromJSON(nodeConfig as HostConfig, this.runtime);
                    break;
                case 'switch':
                    node = Switch.fromJSON(nodeConfig as SwitchConfig, this.runtime);
                    break;
                case 'router':
                    node = Vermittlungsrechner.fromJSON(nodeConfig as VermittlungsrechnerConfig, this.runtime);
                    break;
                case 'modem':
                    node = Modem.fromJSON(nodeConfig as ModemConfig, this.runtime);
                    break;
                default:
                    continue;
            }

            nodes.push(node);
            if (nodeConfig.id) {
                nodeMap.set(nodeConfig.id, node);
            }
        }

        // Create cables
        const cables: Kabel[] = [];

        for (const cableConfig of data.cables) {
            const node1 = nodeMap.get(cableConfig.endpoint1.nodeId);
            const node2 = nodeMap.get(cableConfig.endpoint2.nodeId);

            if (node1 && node2) {
                // Check if ID is already used by another cable in this import
                let cableId = cableConfig.id;
                if (!cableId || cables.some(c => c.getId() === cableId)) {
                    console.warn(`[ScenarioManager] Duplicate or missing cable ID '${cableId}', generating new one.`);
                    // Generate a new ID, ensuring it doesn't clash with existing nodes OR cables
                    // Note: setIdCounter has already been called with maxId + 1
                    cableId = this.runtime.ids.generateId();
                }

                const cable = new Kabel(cableId, this.runtime);
                cable.setWireless(cableConfig.wireless ?? false);

                // Get the interfaces
                const getInterface = (node: Knoten, portIndex: number) => {
                    if (node instanceof Host) {
                        return node.getNetworkInterface();
                    } else if (node instanceof Switch) {
                        return node.getPort(portIndex);
                    } else if (node instanceof Vermittlungsrechner) {
                        return node.getInterface(portIndex);
                    } else if (node instanceof Modem) {
                        return node.getNetworkInterface();
                    }
                    return null;
                };

                const iface1 = getInterface(node1, cableConfig.endpoint1.portIndex);
                const iface2 = getInterface(node2, cableConfig.endpoint2.portIndex);

                if (iface1 && iface2) {
                    cable.connect({
                        node: node1,
                        portIndex: cableConfig.endpoint1.portIndex,
                        interface: iface1,
                    }, true);

                    cable.connect({
                        node: node2,
                        portIndex: cableConfig.endpoint2.portIndex,
                        interface: iface2,
                    }, false);

                    cables.push(cable);
                }
            } else {
                console.warn('[ScenarioManager] Could not find nodes for cable:', cableConfig.id);
            }
        }

        if (commit) this.commitScenario(data);

        return { nodes, cables };
    }

    /**
     * Saves scenario to JSON string
     */
    saveToJSON(
        nodes: Knoten[],
        cables: Kabel[],
        name: string
    ): string {
        const scenario = this.exportScenario(nodes, cables, name);
        return JSON.stringify(scenario, null, 2);
    }

    /**
     * Loads scenario from JSON string
     */
    loadFromJSON(json: string): {
        nodes: Knoten[];
        cables: Kabel[];
    } {
        const data = JSON.parse(json) as ScenarioData;
        return this.importScenario(data);
    }

    commitScenario(data: ScenarioData): void {
        this.currentScenario=data;this.runtime.events.emit(Events.SCENARIO_LOADED,{scenario:data});
    }

    getCurrentScenario(): ScenarioData | null { return this.currentScenario; }

}

export const scenarioManager = new ScenarioManager();
