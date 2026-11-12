import { Host } from './Host';
import { Switch } from './Switch';
import { Modem } from './Modem';
import { Vermittlungsrechner } from './Vermittlungsrechner';
import { Kabel, type KabelConfig } from './Kabel';
import type { Knoten } from './Knoten';

/** Reuse live modems for unrelated undo operations; saved sessions contain configuration only. */
export function preserveModems(previous: Knoten[], nodes: Knoten[]): Set<Knoten> {
    const preserved = new Set<Knoten>();
    const configuration = (modem: Modem) => { const { name, position, ...config } = modem.toJSON(); return JSON.stringify(config); };
    nodes.forEach((node, index) => {
        if (!(node instanceof Modem)) return;
        const existing = previous.find(old => old instanceof Modem && old.getId() === node.getId()) as Modem | undefined;
        if (!existing || configuration(existing) !== configuration(node)) return;
        existing.setName(node.getName()); existing.setPosition(node.getPosition()); nodes[index] = existing; preserved.add(existing);
    });
    return preserved;
}
export function restoreDesignCables(nodes: Knoten[], configs: KabelConfig[]): Kabel[] {
    return configs.map(config => {
        const cable = new Kabel(config.id, nodes[0].runtime); cable.setWireless(config.wireless ?? false);
        [config.endpoint1, config.endpoint2].forEach((endpoint, index) => {
            const node = nodes.find(n => n.getId() === endpoint.nodeId)!;
            const iface = node instanceof Host || node instanceof Modem ? node.getNetworkInterface() : node instanceof Switch ? node.getPort(endpoint.portIndex) : node instanceof Vermittlungsrechner ? node.getInterface(endpoint.portIndex) : null;
            if (!iface) throw new Error('Ungültiger Anschluss im Entwurfsverlauf');
            cable.connect({node, interface: iface, portIndex: endpoint.portIndex}, index === 0);
        });
        return cable;
    });
}
