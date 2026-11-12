export { Icons } from '../assets/DeviceIcons';
export type { IconName } from '../assets/DeviceIcons';
import { Host } from '../hardware/Host';
import { Switch } from '../hardware/Switch';
import type { Knoten } from '../hardware/Knoten';

/** An SSID alone is insufficient: wired switches also have a default SSID. */
export function isAccessPoint(node: Knoten, nodes: readonly Knoten[]): node is Switch {
    return node instanceof Switch && nodes.some(peer => {
        if (!(peer instanceof Host)) return false;
        const wireless = peer.getWireless();
        return wireless.enabled && wireless.ssid === node.getSSID();
    });
}

export function deviceIconName(node: Knoten, nodes: readonly Knoten[]): string {
    return isAccessPoint(node, nodes) ? 'accesspoint' : node.getType();
}
