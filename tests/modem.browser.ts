import { Host } from '../src/hardware/Host';
import { Modem } from '../src/hardware/Modem';
import { Kabel } from '../src/hardware/Kabel';
import { SimulationRuntime } from '../src/runtime/SimulationRuntime';
import { Events } from '../src/core/EventBus';
import { Socket } from '../src/transport/Socket';
const connect = (host: Host, modem: Modem) => { const cable = new Kabel(undefined, host.runtime); cable.connect({node:host,portIndex:0,interface:host.getNetworkInterface()},true); cable.connect({node:modem,portIndex:0,interface:modem.getNetworkInterface()},false); return cable; };
export async function runModemRegressions(): Promise<string[]> {
    const passed: string[] = [];
    const assert = (ok: unknown, text: string) => { if (!ok) throw new Error(text); passed.push(text); };
    let testTimeout: ReturnType<typeof setTimeout> | undefined;
    const local = new SimulationRuntime(), remote = new SimulationRuntime();
    const left = new Modem({}, local), right = new Modem({}, remote);
    const a = new Host({type:'rechner',networkInterface:{ip:'10.0.0.1'}}, local), b = new Host({type:'rechner',networkInterface:{ip:'10.0.0.2'}}, remote);
    try {
        const offer = await left.createOffer(), answer = await right.acceptOffer(offer); await left.finalizeConnection(answer);
        if (right.getStatus() !== 'connected') await new Promise<void>((resolve,reject) => { const subscription = remote.events.on(Events.DEVICE_CONFIG_CHANGED, (e: {device?: Modem}) => { if (e.device === right && right.getStatus() === 'connected') { clearTimeout(timeout); subscription.unsubscribe(); resolve(); } }); const timeout=setTimeout(()=>{subscription.unsubscribe();reject(new Error('Partnerkanal nicht verbunden'));},10000); });
        assert(left.getStatus() === 'connected' && right.getStatus() === 'connected', 'Echter WebRTC-Datenkanal verbunden');
        const localLink = connect(a,left), remoteLink = connect(b,right);
        local.network.updateTopology([a,left],[localLink]); remote.network.updateTopology([b,right],[remoteLink]);
        local.simulation.start(); remote.simulation.start();
        assert((await local.network.probe(a,b.getIP())).success, 'ARP und ICMP über zwei getrennte Ethernet-Segmente');
        const server = new Socket('TCP',b); server.bind(12345); server.listen(); server.onData(m => server.send(m.data,m.source));
        const data = 'Grüße 🌐'.repeat(30000), client = new Socket('TCP',a);
        const response = new Promise<string>((resolve,reject) => { client.onConnect(()=>client.send(data)); client.onData(m=>resolve(String(m.data))); client.onError(reject); client.connect(b.getIP(),12345); });
        const timeout = new Promise<never>((_,reject)=>testTimeout = setTimeout(()=>reject(new Error('TCP-Test-Zeitüberschreitung')),20000));
        assert(await Promise.race([response,timeout]) === data, 'Große Unicode-Nutzlast über TCP und WebRTC unverändert übertragen');
        client.close(); local.simulation.pause();
        const paused = local.network.probe(a,b.getIP()); let completed = false; paused.then(()=>completed=true); await new Promise(resolve=>setTimeout(resolve,400));
        assert(!completed, 'Pause hält Kabel und Modemzustellung an'); local.simulation.resume(); assert((await paused).success, 'Fortsetzen liefert ausstehende Pakete aus');
        assert(local.journal.getEntries().length > 0 && remote.journal.getEntries().length > 0, 'Beide Projekte führen eigene Paketjournale');
        const unused = new Modem({}, local); local.network.updateTopology([a,left,unused],[localLink]);
        const offerInFlight = unused.createOffer().then(() => false, () => true); local.dispose();
        assert(await offerInFlight, 'Projekt-Dispose beendet einen laufenden WebRTC-Verbindungsaufbau');
        return passed;
    } finally { clearTimeout(testTimeout); local.dispose(); remote.dispose(); }
}
