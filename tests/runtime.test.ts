import assert from 'node:assert/strict';
import { SimulationRuntime } from '../src/runtime/SimulationRuntime';
import { Host } from '../src/hardware/Host';
import { Switch } from '../src/hardware/Switch';
import { Vermittlungsrechner } from '../src/hardware/Vermittlungsrechner';
import { Kabel } from '../src/hardware/Kabel';
import { Socket } from '../src/transport/Socket';
import { DNSClient, DNSRecordType } from '../src/apps/DNS';
import { DHCPClient } from '../src/apps/DHCP';
import { WebBrowser } from '../src/apps/WebServer';
import { SMTPClient } from '../src/apps/email/SMTPClient';
import { POP3Client } from '../src/apps/email/POP3Client';
import { Email } from '../src/apps/email/Email';
import { ScenarioManager } from '../src/scenario/ScenarioManager';
import { Terminal } from '../src/apps/Terminal';
import { encodeProject, decodeProject } from '../src/scenario/ProjectCodec';
import { reconcileWireless } from '../src/hardware/Wireless';
import { eventBus } from '../src/core/EventBus';

const originalLog = console.log;
console.log = () => {};
let passed = 0;
async function test(name: string, run: (a: SimulationRuntime, b: SimulationRuntime) => Promise<void> | void) {
    const a = new SimulationRuntime(), b = new SimulationRuntime();
    const legacyListeners = eventBus.listenerCount();
    try { await run(a, b); passed++; originalLog(`✓ ${name}`); }
    finally { a.dispose(); b.dispose(); assert.equal(a.events.listenerCount(), 0); assert.equal(b.events.listenerCount(), 0); assert.equal(eventBus.listenerCount(), legacyListeners); }
}
function host(runtime: SimulationRuntime, id: string, ip: string, mac: string, gateway = '') {
    return new Host({ id, type: 'rechner', networkInterface: { ip, mac, gateway, dns: '10.0.1.2' } }, runtime);
}
function link(runtime: SimulationRuntime, a: Host | Switch | Vermittlungsrechner, ai: number, b: Host | Switch | Vermittlungsrechner, bi: number) {
    const iface = (node: typeof a, index: number) => node instanceof Host ? node.getNetworkInterface() : node instanceof Switch ? node.getPort(index)! : node.getInterface(index)!;
    const cable = new Kabel(undefined, runtime);
    cable.connect({ node: a, interface: iface(a, ai), portIndex: ai }, true);
    cable.connect({ node: b, interface: iface(b, bi), portIndex: bi }, false);
    return cable;
}
function routed(runtime: SimulationRuntime) {
    const a = host(runtime, 'client', '10.0.0.2', '02:00:00:00:00:02', '10.0.0.1');
    const b = host(runtime, 'server', '10.0.1.2', '02:00:00:00:01:02', '10.0.1.1');
    const router = new Vermittlungsrechner({ id: 'router', type: 'router', interfaces: [
        { ip: '10.0.0.1', mac: '02:00:00:00:00:01' }, { ip: '10.0.1.1', mac: '02:00:00:00:01:01' }
    ] }, runtime);
    const cables = [link(runtime, a, 0, router, 0), link(runtime, b, 0, router, 1)];
    runtime.network.updateTopology([a, b, router], cables);
    return { a, b, router, cables };
}
async function advance(runtimes: SimulationRuntime[], ms = 8000) {
    for (let elapsed = 0; elapsed < ms; elapsed += 16) { runtimes.forEach(r => r.simulation.step(16)); await Promise.resolve(); }
}
async function settle<T>(runtimes: SimulationRuntime[], promise: Promise<T>, ms = 40000): Promise<T> {
    let done = false, value: T, error: unknown;
    promise.then(v => { done = true; value = v; }, e => { done = true; error = e; });
    for (let elapsed = 0; elapsed < ms && !done; elapsed += 16) { runtimes.forEach(r => r.simulation.step(16)); await Promise.resolve(); }
    assert.ok(done, 'Operation must settle'); if (error) throw error; return value!;
}
await test('Identical IDs, IPs and MACs keep physical ICMP, ARP and journals in their own project', async (a, b) => {
    const na = routed(a), nb = routed(b);
    const before = b.journal.getEntries().length;
    assert.equal((await settle([a], a.network.probe(na.a, na.b.getIP()))).success, true);
    assert.equal(b.journal.getEntries().length, before); assert.deepEqual(b.network.getARPTable(nb.a), []);
    assert.equal(b.simulation.getSimulationTime(), 0);
    assert.equal((await settle([b], b.network.probe(nb.a, nb.b.getIP()))).success, true);
    assert.ok(a.journal.getEntries().length > 0); assert.ok(b.journal.getEntries().length > 0);
});
await test('Two routed TCP/DNS/HTTP networks deliver their distinct Unicode content concurrently', async (a, b) => {
    const create = (r: SimulationRuntime, text: string) => {
        const n = routed(r), dns = r.hostDnsServerManager.getOrCreateServer(n.b), web = r.hostServerManager.getOrCreateServer(n.b);
        dns.addRecord({ name: 'web.school', type: DNSRecordType.A, value: n.b.getIP(), ttl: 60 }); dns.start();
        web.createFile('index.html', text); web.start(); return new WebBrowser(n.a);
    };
    const ba = create(a, 'Projekt A – Grüße 🌐'), bb = create(b, 'Projekt B – andere Daten');
    const [ra, rb] = await settle([a, b], Promise.all([ba.navigate('http://web.school/'), bb.navigate('http://web.school/')]));
    assert.equal(ra.body, 'Projekt A – Grüße 🌐'); assert.equal(rb.body, 'Projekt B – andere Daten');
    ba.close(); bb.close();
});
await test('Socket ports, timers, default names, IDs, files and unsaved drafts are project owned', async (a, b) => {
    const na = routed(a), nb = routed(b);
    assert.equal(na.a.getName(), 'PC 1'); assert.equal(nb.a.getName(), 'PC 1');
    assert.equal(a.ids.generateId(), b.ids.generateId());
    const sa = new Socket('TCP', na.b), sb = new Socket('TCP', nb.b); assert.ok(sa.bind(1234)); assert.ok(sb.bind(1234));
    assert.equal(new Socket('TCP', na.b).bind(1234), false);
    let firedA = false, firedB = false;
    a.simulation.setTimeout(() => { firedA = true; }, 100); b.simulation.setTimeout(() => { firedB = true; }, 100);
    await advance([a], 100); assert.ok(firedA); assert.equal(firedB, false);
    const fa = a.hostFileSystemManager.getOrCreateFileSystem(na.a), fb = b.hostFileSystemManager.getOrCreateFileSystem(nb.a);
    fa.writeFile('/home/work.txt', 'A'); fb.writeFile('/home/work.txt', 'B');
    a.editorSessions.set('client', [{ path: null, name: 'A', content: 'draft A', isDirty: true }], 0);
    assert.equal(b.editorSessions.get('client'), undefined);
    const snapshot = a.services.snapshot([na.a, na.b, na.router]);
    assert.equal(snapshot.fileSystems![0].fsState.children.home.children['work.txt'].content, 'A'); assert.equal(fb.readFile('/home/work.txt'), 'B');
});
await test('DHCP broadcasts and leases with identical MACs remain separate', async (a, b) => {
    const build = (runtime: SimulationRuntime, start: string) => {
        const client = host(runtime, 'client', '0.0.0.0', '02:00:00:00:00:02');
        const server = host(runtime, 'server', '10.0.0.1', '02:00:00:00:00:01');
        runtime.network.updateTopology([client, server], [link(runtime, client, 0, server, 0)]);
        runtime.hostDhcpServerManager.getOrCreateServer(server, { rangeStart: start, rangeEnd: start, subnetMask: '255.255.255.0', router: server.getIP(), leaseTime: 3600, dns: [server.getIP()] }).start();
        return new DHCPClient(client.getMAC(), 'same-client', client);
    };
    const ca = build(a, '10.0.0.100'), cb = build(b, '10.0.0.200');
    const [la, lb] = await settle([a, b], Promise.all([ca.requestIP(), cb.requestIP()]));
    assert.equal(la.ip, '10.0.0.100'); assert.equal(lb.ip, '10.0.0.200');
    ca.cancel(); cb.cancel();
});
await test('SMTP and POP3 with identical host IDs transfer to the correct project mailbox', async (a, b) => {
    const send = async (r: SimulationRuntime, text: string) => {
        const n = routed(r), server = r.hostEmailServerManager.getOrCreateServer(n.b); server.setMailDomain('school.test'); server.addAccount('alice', 'secret'); server.start();
        const mail = new Email(); mail.setFrom('bob@school.test'); mail.addTo('alice@school.test'); mail.setSubject(text); mail.setBody(text);
        const smtp = new SMTPClient(n.a); const result = await smtp.sendEmail(n.b.getIP(), mail, 'bob@school.test', ['alice@school.test']);
        assert.equal(result.success, true); return { n, server };
    };
    const [ma, mb] = await settle([a, b], Promise.all([send(a, 'Mail A'), send(b, 'Mail B')]));
    const read = async (n: typeof ma.n) => { const pop = new POP3Client(n.a); assert.equal((await pop.connect(n.b.getIP(), 'alice', 'secret')).success, true); const mail = await pop.retrieveMessage(1); await pop.disconnect(); return mail; };
    const [ra, rb] = await settle([a, b], Promise.all([read(ma.n), read(mb.n)]));
    assert.ok(JSON.stringify(ra).includes('Mail A')); assert.ok(!JSON.stringify(ra).includes('Mail B')); assert.ok(JSON.stringify(rb).includes('Mail B'));
});
await test('Stopping one runtime settles outstanding DNS/HTTP/SMTP/POP3/P2P/probes without stopping its neighbour', async (a, b) => {
    const na = routed(a), nb = routed(b), dns = new DNSClient('10.0.1.99', na.a), browser = new WebBrowser(na.a);
    const email = new Email(); email.setFrom('a@school.test'); email.addTo('b@school.test');
    const pending = [dns.resolve('missing.school'), browser.navigate('http://10.0.1.99/'), new SMTPClient(na.a).sendEmail('10.0.1.99', email, 'a@school.test', ['b@school.test']),
        new POP3Client(na.a).connect('10.0.1.99', 'alice', 'secret'), a.peerToPeerManager.getOrCreate(na.a).download({ name: 'x', path: '/home/x', ip: '10.0.1.99', port: 6346, size: 1 }), a.network.probe(na.a, '10.0.1.99')];
    const all = Promise.allSettled(pending);
    const neighbour = b.network.probe(nb.a, nb.b.getIP());
    await Promise.resolve(); a.stop();
    const results = await settle([], all); assert.equal(results.length, 6); assert.equal(a.operations.size, 0);
    assert.equal((await settle([b], neighbour)).success, true);
});
await test('A project replacement cancels old queries and timers before restoring services with reused IDs', async (a) => {
    const old = routed(a), dns = new DNSClient('10.0.1.99', old.a);
    const query = dns.resolve('missing.school').catch(() => 'cancelled');
    let expired = false; a.simulation.setTimeout(() => { expired = true; }, 100);
    const manager = new ScenarioManager(a), scenario = manager.exportScenario([old.a, old.b, old.router], old.cables, 'Replacement');
    const next = manager.importScenario(scenario, false);
    a.services.replace({}, next.nodes, [old.a, old.b, old.router]); a.network.updateTopology(next.nodes, next.cables);
    assert.equal(await settle([], query), 'cancelled'); await advance([a], 500); assert.equal(expired, false);
    assert.equal((await settle([a], a.network.probe(next.nodes[0] as Host, (next.nodes[1] as Host).getIP()))).success, true);
});
await test('Stopping during asynchronous DNS loading prevents late requests from restarting on the new topology', async (a) => {
    const n = routed(a); const resolving = n.a.resolveHost('late.school'); a.stop();
    assert.equal(await resolving, null); assert.equal(a.network.getSocketStates(n.a).length, 0);
});
await test('Stopping an already stopped clock cancels timers and interrupted ping delays settle', async (a) => {
    let called = false; a.simulation.setTimeout(() => { called = true; }, 100); a.simulation.stop(); await advance([a], 200); assert.equal(called, false);
    const n = routed(a), terminal = new Terminal(n.a);
    const ping = terminal.executeCommand('ping 10.0.1.2 -c 3'); await advance([a], 300); a.stop();
    await settle([], ping); assert.equal(a.operations.size, 0);
});
await test('Foreign topologies, cables and bound socket reassignment are rejected', (a, b) => {
    const na = routed(a), nb = routed(b);
    assert.throws(() => a.network.updateTopology([nb.a], []), /anderen Projekt/);
    assert.throws(() => a.hostFileSystemManager.getOrCreateFileSystem(nb.a), /anderen Projekt/);
    assert.throws(() => a.hostDnsServerManager.getOrCreateServer(nb.a), /anderen Projekt/);
    assert.throws(() => a.services.restore({}, [nb.a]), /anderen Projekt/);
    const foreign = new Kabel(undefined, a); assert.throws(() => foreign.connect({node: nb.a, interface: nb.a.getNetworkInterface(), portIndex: 0}, true), /unterschiedlichen Projekten/);
    const socket = new Socket('UDP', na.a); socket.bind(1000); assert.throws(() => socket.setHost(nb.a), /gebundener Socket/);
});
await test('Repeated stops preserve configured server activation for a restart', async (a) => {
    const n = routed(a);
    const servers = [a.hostServerManager.getOrCreateServer(n.b), a.hostDnsServerManager.getOrCreateServer(n.b), a.hostEchoServerManager.getOrCreateServer(n.b),
        a.hostEmailServerManager.getOrCreateServer(n.b), a.hostDhcpServerManager.getOrCreateServer(n.a), a.peerToPeerManager.getOrCreate(n.b)];
    servers.forEach(server => server.start());
    a.stop(); a.stop(); a.services.start(); assert.ok(servers.every(server => server.isRunning()));
    assert.equal((await settle([a], new WebBrowser(n.a).navigate('http://10.0.1.2/'))).status, 200);
});
await test('FLS and JSON restore a live project into an independent runtime without losing files or drafts', async (a, b) => {
    const n = routed(a); a.hostServerManager.getOrCreateServer(n.b).start();
    a.hostFileSystemManager.getOrCreateFileSystem(n.b).writeFile('/web/index.html', 'Round trip – Grüße');
    a.editorSessions.set('client', [{path: '/home/lesson.txt', name: 'lesson.txt', content: 'Unsaved lesson', isDirty: true}], 0);
    const snapshot = new ScenarioManager(a).exportScenario([n.a, n.b, n.router], n.cables, 'School network', a.services.snapshot([n.a, n.b, n.router]));
    for (const format of ['fls', 'json'] as const) {
        const decoded = await decodeProject(encodeProject(snapshot, format).bytes, 'network.' + format); assert.deepEqual(decoded.scenario, JSON.parse(JSON.stringify(snapshot)));
        const imported = new ScenarioManager(b).importScenario(decoded.scenario); b.services.replace(decoded.scenario.serviceState!, imported.nodes, b.network.getHosts());
        b.network.updateTopology(imported.nodes, imported.cables); b.services.start();
        const browser = new WebBrowser(imported.nodes[0] as Host);
        assert.equal((await settle([b], browser.navigate('http://10.0.1.2/'))).body, 'Round trip – Grüße'); browser.close();
        assert.equal(b.editorSessions.get('client')!.tabs[0].content, 'Unsaved lesson');
        b.hostFileSystemManager.getOrCreateFileSystem(imported.nodes[1] as Host).writeFile('/web/index.html', 'Changed copy');
        assert.equal(a.hostFileSystemManager.getFileSystem('server')!.readFile('/web/index.html'), 'Round trip – Grüße');
    }
});
await test('WLAN association and peer downloads use the project clock and physical network', async (a, b) => {
    const build = (r: SimulationRuntime, content: string) => {
        const left = host(r, 'client', '10.0.0.2', '02:00:00:00:00:02'), right = host(r, 'server', '10.0.0.3', '02:00:00:00:00:03');
        const ap = new Switch({id: 'ap', type: 'switch', ssid: 'School'}, r); left.setWireless(true, 'School');
        const cables = reconcileWireless([left, right, ap], [link(r, right, 0, ap, 0)]); assert.equal(cables.filter(c => c.isWireless()).length, 1);
        r.network.updateTopology([left, right, ap], cables); const peer = r.peerToPeerManager.getOrCreate(right);
        r.hostFileSystemManager.getOrCreateFileSystem(right).writeFile('/home/lesson.txt', content); peer.share('/home/lesson.txt'); peer.start();
        return {left, right, peer};
    };
    const na = build(a, 'Lesson A'), nb = build(b, 'Lesson B');
    const downloads = [a.peerToPeerManager.getOrCreate(na.left).download({name:'lesson.txt',path:'/home/lesson.txt',ip:na.right.getIP(),port:6346,size:8}),
        b.peerToPeerManager.getOrCreate(nb.left).download({name:'lesson.txt',path:'/home/lesson.txt',ip:nb.right.getIP(),port:6346,size:8})];
    await settle([a,b], Promise.all(downloads));
    assert.equal(a.hostFileSystemManager.getFileSystem('client')!.readFile('/home/lesson.txt'), 'Lesson A'); assert.equal(b.hostFileSystemManager.getFileSystem('client')!.readFile('/home/lesson.txt'), 'Lesson B');
    const bytes = new Uint8Array([0,255,128,65]); a.hostFileSystemManager.getFileSystem('server')!.writeBytes('/home/source.bin',bytes); na.peer.share('/home/source.bin');
    await settle([a], a.peerToPeerManager.getOrCreate(na.left).download({name:'source.bin',path:'/home/source.bin',ip:na.right.getIP(),port:6346,size:bytes.length}));
    assert.deepEqual(a.hostFileSystemManager.getFileSystem('client')!.readBytes('/home/source.bin'), bytes);
});
await test('Disposed runtimes cannot restart clocks or bind sockets and release physical connections', async (a, b) => {
    const n = routed(a); routed(b); a.dispose();
    assert.equal(a.simulation.start(), false); assert.throws(() => a.simulation.setTimeout(() => {}, 1), /aufgeräumt/);
    assert.equal(new Socket('UDP', n.a).bind(5555), false); assert.equal(n.a.getNetworkInterface().isConnected(), false);
    assert.equal(a.operations.size, 0); assert.equal(a.events.listenerCount(), 0); assert.ok(b.events.listenerCount() > 0);
    assert.equal((await a.network.probe(n.a, n.b.getIP())).success, false); assert.throws(() => a.network.updateTopology([],[]), /aufgeräumt/);
});
console.log = originalLog;
originalLog(`${passed} runtime isolation tests passed`);
