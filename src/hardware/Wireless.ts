import { Host } from './Host';
import { Switch } from './Switch';
import { Kabel } from './Kabel';
import { Knoten } from './Knoten';

/** Filius models Wi-Fi as an Ethernet association to a switch, occupying one switch port. */
export function reconcileWireless(nodes: Knoten[], cables: Kabel[]): Kabel[] {
    const result: Kabel[]=[];
    for(const cable of cables){
        const endpoints=[cable.getEndpoint1(),cable.getEndpoint2()],host=endpoints.find(e=>e?.node instanceof Host)?.node as Host|undefined;
        const accessPoint=endpoints.find(e=>e?.node instanceof Switch)?.node as Switch|undefined;
        if(cable.isWireless() ? !host?.getWireless().enabled||!accessPoint||host.getWireless().ssid!==accessPoint.getSSID() : host?.getWireless().enabled){cable.disconnect();continue;}
        result.push(cable);
    }
    for(const host of nodes.filter((n):n is Host=>n instanceof Host)){
        const config=host.getWireless();if(!config.enabled||!config.ssid||host.getNetworkInterface().isConnected())continue;
        const ap=nodes.find((n):n is Switch=>n instanceof Switch&&n.getSSID()===config.ssid);if(!ap)continue;
        const port=ap.getPorts().findIndex(iface=>!iface.isConnected());if(port<0)continue;
        const link=new Kabel(undefined, host.runtime);link.setWireless(true);
        link.connect({node:host,portIndex:0,interface:host.getNetworkInterface()},true);
        link.connect({node:ap,portIndex:port,interface:ap.getPort(port)!},false);result.push(link);
    }
    return result;
}
