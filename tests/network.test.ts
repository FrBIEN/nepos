import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hostEmailServerManager } from '../src/apps/email/EmailServer';
import { hostServerManager } from '../src/apps/WebServer';
import { Host } from '../src/hardware/Host';
import { Switch } from '../src/hardware/Switch';
import { Vermittlungsrechner } from '../src/hardware/Vermittlungsrechner';
import { Kabel } from '../src/hardware/Kabel';
import { networkStack } from '../src/network/NetworkStack';
import { simulationEngine } from '../src/core/SimulationEngine';
import { Socket } from '../src/transport/Socket';
import { DNSServer, DNSClient, DNSRecordType } from '../src/apps/DNS';
import { WebServer, WebBrowser } from '../src/apps/WebServer';
import { DHCPServer, DHCPClient } from '../src/apps/DHCP';
import { EmailServer } from '../src/apps/email/EmailServer';
import { SMTPClient } from '../src/apps/email/SMTPClient';
import { POP3Client } from '../src/apps/email/POP3Client';
import { Email } from '../src/apps/email/Email';
import { normalizeIP, isValidSubnetMask } from '../src/network/utils';
import { PeerToPeer } from '../src/apps/PeerToPeer';
import { hostFileSystemManager } from '../src/apps/FileSystem';
import { ScenarioManager } from '../src/scenario/ScenarioManager';
import { services } from '../src/apps/Services';
import { hostDhcpServerManager } from '../src/apps/DHCP';
import { hostEchoServerManager } from '../src/apps/EchoServer';
import { reconcileWireless } from '../src/hardware/Wireless';
import { Terminal } from '../src/apps/Terminal';
import { eventBus } from '../src/core/EventBus';

const originalLog = console.log;
console.log = () => {};
let passed = 0;
async function test(name: string, run: () => Promise<void> | void) {
    networkStack.clear();
    try { await run(); passed++; originalLog(`✓ ${name}`); }
    catch (error) { originalLog(`✗ ${name}`); throw error; }
    finally { networkStack.clear(); }
}
function host(ip: string, gateway = '', mask = '255.255.255.0') { return new Host({ type: 'rechner', networkInterface: { ip, gateway, subnetMask: mask } }); }
function iface(node: Host | Switch | Vermittlungsrechner, index = 0) { return node instanceof Host ? node.getNetworkInterface() : node instanceof Switch ? node.getPort(index)! : node.getInterface(index)!; }
function cable(a: Host | Switch | Vermittlungsrechner, ai: number, b: Host | Switch | Vermittlungsrechner, bi: number) {
    const c = new Kabel(); c.connect({ node: a, portIndex: ai, interface: iface(a, ai) }, true); c.connect({ node: b, portIndex: bi, interface: iface(b, bi) }, false); return c;
}
async function advance(ms = 10000) { for (let elapsed = 0; elapsed < ms; elapsed += 16) { simulationEngine.step(16); await Promise.resolve(); } }
async function settle<T>(promise: Promise<T>, ms = 20000): Promise<T> {
    let done = false, result: T, error: unknown;
    promise.then(value => { result = value; done = true; }, e => { error = e; done = true; });
    for (let elapsed = 0; elapsed < ms && !done; elapsed += 16) { simulationEngine.step(16); await Promise.resolve(); }
    assert.ok(done, 'Operation did not settle in simulated time'); if (error) throw error; return result!;
}
function routed() {
    const a = host('192.168.1.10', '192.168.1.1'), b = host('192.168.2.10', '192.168.2.1');
    const r = new Vermittlungsrechner({ type: 'router' });
    const cables = [cable(a, 0, r, 0), cable(r, 1, b, 0)]; networkStack.updateTopology([a, b, r], cables); return { a, b, r, cables };
}
await test('Strict IPv4 and contiguous subnet validation', () => {
    assert.equal(normalizeIP('12x.0.0.1'), null); assert.equal(normalizeIP('1..2.3'), null); assert.equal(normalizeIP('256.2.3.4'), null);
    assert.equal(isValidSubnetMask('255.0.255.0'), false); assert.equal(isValidSubnetMask('255.255.254.0'), true);
});
await test('Physical ARP, switch learning and ICMP echo', async () => {
    const a = host('10.0.0.1'), b = host('10.0.0.2'), sw = new Switch({ type: 'switch' });
    networkStack.updateTopology([a, b, sw], [cable(a, 0, sw, 0), cable(b, 0, sw, 1)]);
    assert.equal((await settle(networkStack.probe(a, b.getIP()))).success, true);
    assert.deepEqual(networkStack.getARPTable(a), [{ ip: b.getIP(), mac: b.getMAC() }]); assert.equal(sw.lookupMAC(b.getMAC()), 1);
});
await test('Unconnected devices and missing gateways cannot communicate', async () => {
    const a = host('10.0.0.1'), b = host('10.0.0.2'); networkStack.updateTopology([a, b], []);
    assert.equal((await settle(networkStack.probe(a, b.getIP()))).success, false);
    const { a: ra, b: rb } = routed(); ra.getNetworkInterface().setGateway('');
    assert.equal((await settle(networkStack.probe(ra, rb.getIP()))).success, false);
});
await test('Gateway ARP, routing, TTL exceeded and real return traffic', async () => {
    const { a, b, r } = routed();
    const ping = await settle(networkStack.probe(a, b.getIP())); assert.equal(ping.success, true); assert.equal(ping.ttl, 63);
    assert.equal(networkStack.getARPTable(a)[0].ip, r.getInterface(0)!.getIP());
    const hop = await settle(networkStack.probe(a, b.getIP(), 1)); assert.equal(hop.exceeded, true); assert.equal(hop.ip, '192.168.1.1');
    r.setIPForwardingEnabled(false); assert.equal((await settle(networkStack.probe(a, b.getIP()))).success, false);
});
await test('Firewall enforces transport, CIDR /0 and actual port rules', async () => {
    const { a, b, r } = routed(); r.setFirewallEnabled(true);
    assert.equal((await settle(networkStack.probe(a, b.getIP()))).success, false);
    r.updateFirewallRule('default-deny', { action: 'allow', protocol: 'icmp', sourceIP: '0.0.0.0/0' });
    assert.equal((await settle(networkStack.probe(a, b.getIP()))).success, true);
    r.updateFirewallRule('default-deny', { protocol: 'tcp', destPort: '80' }); assert.equal(r.checkFirewall(a.getIP(), b.getIP(), 'tcp', 123, 0), false);
});
await test('TCP handshake and concurrent clients preserve data including control-like strings', async () => {
    const { a, b } = routed(); const server = new Socket('TCP', b); assert.ok(server.bind(1234)); server.listen();
    server.onData(m => server.send(m.data, m.source));
    const clients = Array.from({ length: 3 }, () => new Socket('TCP', a));
    const results = clients.map((s, i) => new Promise<string>(resolve => { s.onConnect(() => s.send(['SYN', 'ACK', 'FIN'][i])); s.onData(m => resolve(String(m.data))); s.connect(b.getIP(), 1234); }));
    assert.deepEqual(await settle(Promise.all(results)), ['SYN', 'ACK', 'FIN']);
});
await test('TCP retransmission recovers a dropped data frame exactly once', async () => {
    const { a, b, cables } = routed(); const server = new Socket('TCP', b); server.bind(1234); server.listen(); let count = 0;
    server.onData(m => { count++; server.send(m.data, m.source); });
    const client = new Socket('TCP', a); client.connect(b.getIP(), 1234); await advance(5000); assert.equal(client.getState(), 'CONNECTED');
    const result = new Promise(resolve => client.onData(m => resolve(m.data))); client.send('recover');
    simulationEngine.step(16); cables[0].clearTransit();
    assert.equal(await settle(result), 'recover'); assert.equal(count, 1);
});
await test('TCP and UDP can bind same port; conflicts and closed sockets are rejected', async () => {
    const { a, b } = routed(); const tcp = new Socket('TCP', a), udp = new Socket('UDP', a), conflict = new Socket('TCP', a);
    assert.ok(tcp.bind(5555)); assert.ok(udp.bind(5555)); assert.equal(conflict.bind(5555), false);
    assert.equal(new Socket('UDP', a).send('no', { ip: b.getIP(), port: 7 }), false);
    const client = new Socket('TCP', a); let error = ''; client.onError(e => error = e.message); client.connect(b.getIP(), 1234); await advance(6000);
    assert.match(error, /abgelehnt/); assert.equal(client.getState(), 'CLOSED');
});
await test('DNS resolution traverses routed UDP and preserves records', async () => {
    const { a, b } = routed(); const server = new DNSServer(b); server.addRecord({ name: 'web.test', type: DNSRecordType.A, ttl: 60, value: b.getIP() }); server.start();
    const client = new DNSClient(b.getIP(), a); assert.equal((await settle(client.resolve('web.test')))[0].value, b.getIP()); client.close(); server.stop();
});
await test('HTTP fetch traverses TCP and transfers Unicode intact', async () => {
    const { a, b } = routed(); const server = new WebServer(b); server.createFile('index.html', '<h1>Grüße 🌐</h1>'); server.start();
    const response = await settle(new WebBrowser(a).navigate(`http://${b.getIP()}/`)); assert.equal(response.status, 200); assert.equal(response.body, '<h1>Grüße 🌐</h1>'); server.stop();
});
await test('DHCP broadcasts stay in their Ethernet broadcast domain', async () => {
    const { a, b } = routed(); const server = new DHCPServer(b.getIP(), { rangeStart: '192.168.2.100', rangeEnd: '192.168.2.110' }, b); server.start();
    const socket = new Socket('UDP', a); socket.bind(68); let responses = 0; socket.onData(() => responses++);
    socket.send({ type: 1, transactionId: 1, clientMAC: a.getMAC(), options: {} }, { ip: '255.255.255.255', port: 67 }); await advance(3000); assert.equal(responses, 0); server.stop();
});
await test('SMTP delivers email over routed TCP; POP3 authenticates and retrieves it', async () => {
    const { a, b } = routed(); const server = new EmailServer(b); server.setMailDomain('mail.test'); server.addAccount('bob', 'secret'); server.start();
    const email = new Email(); email.setFrom('alice@mail.test'); email.addTo('bob@mail.test'); email.setSubject('Netzwerktest'); email.setBody('Grüße aus dem anderen Subnetz');
    const sent = await settle(new SMTPClient(a).sendEmail(b.getIP(), email, 'alice@mail.test', ['bob@mail.test'])); assert.equal(sent.success, true);
    const pop = new POP3Client(a); assert.equal((await settle(pop.connect(b.getIP(), 'bob', 'secret'))).success, true);
    assert.equal((await settle(pop.getStats())).data?.messageCount, 1);
    const message = await settle(pop.retrieveMessage(1)); assert.equal(message.success, true); assert.match(message.data!.getBody(), /Grüße/);
    await settle(pop.disconnect()); server.stop();
});
await test('NAT translates ICMP and TCP with a genuine reply path', async () => {
    const { a, b, r } = routed(); r.setNATEnabled(true); b.getNetworkInterface().setGateway('');
    assert.equal((await settle(networkStack.probe(a, b.getIP()))).success, true);
    const server = new Socket('TCP', b); server.bind(8080); server.listen(); server.onData(m => server.send(m.data, m.source));
    const client = new Socket('TCP', a); const echo = new Promise(resolve => { client.onConnect(() => client.send('NAT')); client.onData(m => resolve(m.data)); }); client.connect(b.getIP(), 8080);
    assert.equal(await settle(echo), 'NAT'); assert.equal(networkStack.getNATTable(r).find(e => e.protocol === 'TCP')?.insideIP, a.getIP());
});
await test('NAT port forwarding exposes only the configured internal service', async () => {
    const { a, b, r } = routed(); r.setNATEnabled(true); r.addPortForward({ protocol: 'tcp', externalPort: 8080, internalIP: a.getIP(), internalPort: 80 });
    const server = new WebServer(a); server.createFile('index.html', 'Portweiterleitung'); server.start();
    const client = new Socket('TCP', b); const response = new Promise(resolve => { client.onConnect(() => client.send('GET / HTTP/1.1\r\n\r\n')); client.onData(m => resolve(m.data)); }); client.connect(r.getInterface(1)!.getIP(), 8080);
    assert.match(String(await settle(response)), /Portweiterleitung/); server.stop();
});
await test('RIP learns routes from packets and expires them when a link fails', async () => {
    const a = host('10.1.0.10', '10.1.0.1'), b = host('10.2.0.10', '10.2.0.1');
    const r1 = new Vermittlungsrechner({ type: 'router', ripEnabled: true, interfaces: [{ ip: '10.1.0.1' }, { ip: '10.0.0.1' }] });
    const r2 = new Vermittlungsrechner({ type: 'router', ripEnabled: true, interfaces: [{ ip: '10.0.0.2' }, { ip: '10.2.0.1' }] });
    const link = cable(r1, 1, r2, 0); networkStack.updateTopology([a, b, r1, r2], [cable(a, 0, r1, 0), link, cable(r2, 1, b, 0)]);
    await advance(35000); assert.equal(r1.findRoute(b.getIP())?.gateway, '10.0.0.2');
    const ping = await settle(networkStack.probe(a, b.getIP())); assert.equal(ping.success, true); assert.equal(ping.ttl, 62);
    link.disconnect(); await advance(200000); assert.equal(r1.findRoute(b.getIP()), null);
});
await test('Concurrent DHCP clients receive distinct leases, renew and release over packets', async () => {
    const serverHost = host('10.1.0.1'), sw = new Switch({type:'switch'}), clients = Array.from({length:3}, () => host('0.0.0.0'));
    networkStack.updateTopology([serverHost, sw, ...clients], [cable(serverHost,0,sw,0), ...clients.map((h,i) => cable(h,0,sw,i+1))]);
    const server = new DHCPServer(serverHost.getIP(), {rangeStart:'10.1.0.100',rangeEnd:'10.1.0.102',subnetMask:'255.255.255.0',leaseTime:10},serverHost); server.start();
    const requests = clients.map(h => new DHCPClient(h.getMAC(),h.getName(),h));
    const configs = await settle(Promise.all(requests.map(c => c.requestIP())));
    configs.forEach((cfg,i) => clients[i].getNetworkInterface().setIP(cfg.ip));
    assert.equal(new Set(configs.map(c => c.ip)).size,3); assert.equal(server.getLeases().length,3);
    await advance(12000); assert.ok(server.getLeases().every(l => l.leaseEnd > simulationEngine.getSimulationTime()));
    requests[0].release(); await advance(2000); assert.equal(server.getLeases().length,2); requests.forEach(c => c.cancel()); server.stop();
});
await test('Cancellation settles pending DHCP operations without applying a fallback address', async () => {
    const a=host('0.0.0.0'); networkStack.updateTopology([a],[]); const client=new DHCPClient(a.getMAC(),a.getName(),a);
    const pending=client.requestIP(); let rejected=false; pending.catch(() => rejected=true); client.cancel(); await advance(32); assert.equal(rejected,true);
});
await test('Peer search traverses a relay and downloads the actual shared file', async () => {
    const a=host('10.0.0.1'),b=host('10.0.0.2'),c=host('10.0.0.3'),sw=new Switch({type:'switch'});
    networkStack.updateTopology([a,b,c,sw],[cable(a,0,sw,0),cable(b,0,sw,1),cable(c,0,sw,2)]);
    const peers=[a,b,c].map(h => new PeerToPeer(h)); peers.forEach(p => p.start());
    const fs=hostFileSystemManager.getOrCreateFileSystem(c); fs.mkdir('/home'); fs.writeFile('/home/referenz.txt','Echte Daten 🌐'); peers[2].share('/home/referenz.txt');
    peers[0].connect(b.getIP()); peers[1].connect(c.getIP()); await advance(4000);
    const hit=new Promise<any>(resolve => peers[0].onHit(resolve)); peers[0].search('referenz'); const result=await settle(hit);
    const path=await settle(peers[0].download(result)); assert.equal(hostFileSystemManager.getOrCreateFileSystem(a).readFile(path),'Echte Daten 🌐');
    await assert.rejects(() => settle(peers[0].download(result)), /existiert/); peers.forEach(p => p.stop());
});
await test('Scenario roundtrip preserves topology and rejects corrupt occupied endpoints atomically', async () => {
    const {a,b,r,cables}=routed(); a.setInstalledApps(['firewall','peertopeer']); a.setFirewall({enabled:true,blockICMP:true,rules:[{protocol:'tcp',port:80,localOnly:true}]});
    const manager=new ScenarioManager(), data=manager.exportScenario([a,b,r],cables,'Test'); const restored=manager.importScenario(JSON.parse(JSON.stringify(data)));
    assert.equal(restored.cables.length,2); assert.deepEqual((restored.nodes[0] as Host).getFirewall(),a.getFirewall()); assert.equal((restored.nodes[0] as Host).isAppInstalled('webbrowser'),false);
    const before=manager.getCurrentScenario(); const bad=structuredClone(data); bad.cables.push({...bad.cables[0],id:'duplicate'});
    assert.throws(() => manager.importScenario(bad), /belegter/); assert.equal(manager.getCurrentScenario(),before);
    const badIP=structuredClone(data); (badIP.nodes[0] as ReturnType<Host['toJSON']>).networkInterface!.ip='999.0.0.1'; assert.throws(() => manager.importScenario(badIP), /IP-Adresse/);
});
await test('Service lifecycle remembers running services and does not start configured stopped DHCP', async () => {
    const a=host('10.0.0.1'); networkStack.updateTopology([a],[]); services.restore({},[a]);
    const dhcp=hostDhcpServerManager.getOrCreateServer(a); const echo=hostEchoServerManager.getOrCreateServer(a,12345); echo.start(); assert.ok(echo.isRunning());
    services.stop(); networkStack.clear(); services.start(); assert.equal(dhcp.isRunning(),false); assert.equal(echo.isRunning(),true);
    const snapshot=services.snapshot([a]); services.restore(snapshot,[a]); assert.equal(hostEchoServerManager.getServer(a.getId())!.isRunning(),false);
    services.start(); assert.ok(hostEchoServerManager.getServer(a.getId())!.isRunning()); services.restore();
});
await test('Personal firewall blocks external initial connections, permits responses and persists', async () => {
    const {a,b}=routed(); b.setFirewall({enabled:true,blockICMP:true,rules:[]}); assert.equal((await settle(networkStack.probe(a,b.getIP()))).success,false);
    const server=new Socket('TCP',b); server.bind(8080); server.listen(); server.onData(m=>server.send(m.data,m.source));
    const denied=new Socket('TCP',a); denied.connect(b.getIP(),8080); await advance(13000); assert.equal(denied.getState(),'CLOSED');
    b.setFirewall({enabled:true,blockICMP:false,rules:[{protocol:'tcp',port:8080,localOnly:true}]}); const localDenied=new Socket('TCP',a); localDenied.connect(b.getIP(),8080); await advance(13000); assert.equal(localDenied.getState(),'CLOSED');
    b.setFirewall({enabled:true,blockICMP:false,rules:[{protocol:'tcp',port:8080,localOnly:false}]}); a.setFirewall({enabled:true,blockICMP:false,rules:[]});
    const client=new Socket('TCP',a); const response=new Promise(resolve=>{client.onConnect(()=>client.send('freigegeben'));client.onData(m=>resolve(m.data));});client.connect(b.getIP(),8080); assert.equal(await settle(response),'freigegeben');
});
await test('DNS resolves aliases and delegates subdomains over routed UDP', async () => {
    const a=host('10.0.0.1'), b=host('10.0.0.2'), c=host('10.0.0.3'), sw=new Switch({type:'switch'});
    networkStack.updateTopology([a,b,c,sw],[cable(a,0,sw,0),cable(b,0,sw,1),cable(c,0,sw,2)]);
    const root=new DNSServer(b), zone=new DNSServer(c);
    root.addRecord({name:'lab.test',type:DNSRecordType.NS,ttl:5,value:'ns.test'}); root.addRecord({name:'ns.test',type:DNSRecordType.A,ttl:5,value:c.getIP()});
    root.addRecord({name:'alias.test',type:DNSRecordType.CNAME,ttl:5,value:'www.lab.test'}); zone.addRecord({name:'www.lab.test',type:DNSRecordType.A,ttl:5,value:'10.0.0.99'}); root.start();zone.start();
    const client=new DNSClient(b.getIP(),a); assert.equal((await settle(client.resolve('alias.test')))[0].value,'10.0.0.99');
    zone.removeRecord('www.lab.test',DNSRecordType.A);zone.addRecord({name:'www.lab.test',type:DNSRecordType.A,ttl:5,value:'10.0.0.100'});
    assert.equal((await client.resolve('alias.test'))[0].value,'10.0.0.99'); await advance(6000); assert.equal((await settle(client.resolve('alias.test')))[0].value,'10.0.0.100');
    root.addRecord({name:'loop.test',type:DNSRecordType.CNAME,ttl:5,value:'loop.test'}); await assert.rejects(()=>settle(client.resolve('loop.test')),/SERVER_FAILURE/); client.close();root.stop();zone.stop();
});
await test('HTTP custom ports, DNS names, missing resources, path traversal and unsupported schemes', async () => {
    const {a,b}=routed(); const server=new WebServer(b);server.setPort(8080);server.createFile('index.html','Port 8080');server.start();
    const dns=new DNSServer(b);dns.addRecord({name:'web.test',type:DNSRecordType.A,ttl:60,value:b.getIP()});dns.start();a.getNetworkInterface().setDNS(b.getIP());
    const browser=new WebBrowser(a);assert.equal((await settle(browser.navigate('http://web.test:8080/'))).body,'Port 8080');
    assert.equal((await settle(browser.fetchResource(`http://${b.getIP()}:8080/missing.txt`))).status,404);
    assert.equal(server.handleRequest({method:'GET',path:'/../../home/private.txt',headers:{}},a.getIP()).status,403);
    assert.equal((await browser.navigate('https://web.test/')).status,0); browser.close();server.stop();dns.stop();
});
await test('SMTP rejects all recipients and times out when the peer stays silent', async () => {
    const {a,b}=routed();const server=new EmailServer(b);server.setMailDomain('mail.test');server.start();const email=new Email();email.setFrom('alice@mail.test');email.setBody('test');
    assert.equal((await settle(new SMTPClient(a).sendEmail(b.getIP(),email,'alice@mail.test',['missing@mail.test']))).success,false);server.stop();
    const silent=new Socket('TCP',b);silent.bind(25);silent.listen();assert.match((await settle(new SMTPClient(a).sendEmail(b.getIP(),email,'alice@mail.test',['bob@mail.test']),35000)).message,/Zeitüberschreitung/);
});
await test('File system validates names, preserves content and serializes special property names', async () => {
    const a=host('10.0.0.1');const fs=hostFileSystemManager.getOrCreateFileSystem(a);assert.equal(fs.writeFile('/home/','bad'),false);assert.equal(fs.mkdir('/home/..'),false);
    assert.ok(fs.writeFile('/home/__proto__','Grüße'));const stored=JSON.parse(JSON.stringify(fs.toJSON()));assert.equal(stored.children.home.children.__proto__.content,'Grüße');
    fs.restoreFromJSON(stored);assert.equal(fs.readFile('/home/__proto__'),'Grüße');assert.equal(fs.getStats('/home/__proto__')!.size,new TextEncoder().encode('Grüße').length);assert.ok(fs.touch('/home/__proto__'));assert.equal(fs.readFile('/home/__proto__'),'Grüße');
});
await test('Saved web files survive project restore and stopped services remain stopped in snapshots', async () => {
    const a=host('10.0.0.1');networkStack.updateTopology([a],[]);services.restore({},[a]);const server=hostServerManager.getOrCreateServer(a);server.createFile('index.html','Eigene Seite');server.start();
    const state=services.snapshot([a]);services.restore(state,[a]);services.start();assert.equal(hostServerManager.getServer(a.getId())!.getFile('/index.html')!.content,'Eigene Seite');
    hostServerManager.getServer(a.getId())!.stop();assert.equal(services.snapshot([a]).webServers![0].running,false);services.restore();
});
await test('Packaged example imports, restores DNS, HTTP and email services correctly', async () => {
    const data=JSON.parse(readFileSync('public/examples/lernnetz.json','utf8'));const loaded=new ScenarioManager().importScenario(data);const hosts=loaded.nodes.filter((n):n is Host=>n instanceof Host);
    services.restore(data.serviceState,hosts);networkStack.updateTopology(loaded.nodes,loaded.cables);services.start();
    const response=await settle(new WebBrowser(hosts[0]).navigate('http://web.schule.test/'));assert.match(response.body,/Willkommen im Lernnetz/);assert.equal(response.status,200);
    const email=new Email();email.setFrom('schueler@schule.test');email.addTo('schueler@schule.test');email.setBody('Lernnetz');
    const result=await settle(new SMTPClient(hosts[0]).sendEmail(hosts[1].getIP(),email,'schueler@schule.test',['schueler@schule.test']));assert.equal(result.success,true);
    services.stop();services.restore();
});
await test('Remote email forwarding uses DNS MX and real routed SMTP delivery', async () => {
    const {a,b}=routed();services.restore({},[a,b]);a.getNetworkInterface().setDNS(a.getIP());
    const dns=new DNSServer(a);dns.addRecord({name:'other.test',type:DNSRecordType.MX,ttl:60,value:'10 mail.other.test'});dns.addRecord({name:'mail.other.test',type:DNSRecordType.A,ttl:60,value:b.getIP()});dns.start();
    const source=hostEmailServerManager.getOrCreateServer(a),destination=hostEmailServerManager.getOrCreateServer(b);source.setMailDomain('source.test');source.addAccount('alice','secret');destination.setMailDomain('other.test');destination.addAccount('bob','secret');source.start();destination.start();
    const email=new Email();email.setFrom('alice@source.test');email.addTo('bob@other.test');email.setSubject('Weiterleitung');email.setBody('über MX und Router');
    assert.equal((await settle(new SMTPClient(a).sendEmail(a.getIP(),email,'alice@source.test',['bob@other.test']))).success,true);await advance(10000);
    assert.equal(destination.findAccount('bob')!.getMessages().length,1);assert.equal(destination.findAccount('bob')!.getMessages()[0].getSubject(),'Weiterleitung');dns.stop();services.restore();
});
await test('Loopback HTTP and ICMP work without cables and socket bindings remain local', async () => {
    const a=host('10.0.0.1'); networkStack.updateTopology([a],[]);
    const server=new WebServer(a);server.createFile('index.html','Localhost');server.start();
    const browser=new WebBrowser(a);assert.equal((await settle(browser.navigate('http://localhost/'))).body,'Localhost');
    assert.equal((await settle(networkStack.probe(a,'127.0.0.1'))).success,true);
    assert.equal(new Socket('TCP',a).bind(1234,'10.0.0.99'),false);
    const localOnly=new Socket('TCP',a);localOnly.bind(1234,'127.0.0.1');localOnly.listen();
    const client=new Socket('TCP',a);const rejected=new Promise(resolve=>client.onError(error=>resolve(error.message)));client.connect(a.getIP(),1234);
    assert.match(String(await settle(rejected)),/abgelehnt/);browser.close();server.stop();
});
await test('TCP graceful close retransmits pending data and a lost FIN before disconnecting', async () => {
    const a=host('10.0.0.1'),b=host('10.0.0.2'),link=cable(a,0,b,0);networkStack.updateTopology([a,b],[link]);
    const server=new Socket('TCP',b);server.bind(1234);server.listen();let received='';server.onData(m=>received+=String(m.data));
    const client=new Socket('TCP',a);client.connect(b.getIP(),1234);await advance(2000);assert.equal(client.getState(),'CONNECTED');
    let dataDropped=false,finDropped=false;const unsubscribe=eventBus.on('interface:queue',(event:{mac:string})=>{
        if(event.mac!==a.getMAC())return;
        const outgoing=a.getNetworkInterface().getTxQueue();
        const index=outgoing.findIndex(p=>!dataDropped&&p.tcp?.flags.includes('PSH') || !finDropped&&p.tcp?.flags.includes('FIN'));
        if(index>=0){const [p]=outgoing.splice(index,1);if(p.tcp!.flags.includes('PSH'))dataDropped=true;else finDropped=true;}
    });
    const disconnected=new Promise(resolve=>server.onDisconnect(resolve));client.send('before close');client.close();await settle(disconnected,20000);unsubscribe.unsubscribe();
    assert.equal(received,'before close');assert.ok(dataDropped&&finDropped);await advance(5000);assert.equal(server.getState(),'LISTENING');
});
await test('Original terminal file commands, aliases, quoted names and real netstat/tcpdump work', async () => {
    const {a,b}=routed();const terminal=new Terminal(a),fs=hostFileSystemManager.getOrCreateFileSystem(a);fs.writeFile('/home/with space.txt','actual file');
    assert.equal(await terminal.executeCommand('copy "with space.txt" copied.txt'),'');assert.equal(await terminal.executeCommand('mv copied.txt moved.txt'),'');assert.equal(await terminal.executeCommand('type moved.txt'),'actual file');
    assert.equal(fs.transfer('/home','/home/nested'),false);assert.equal(fs.exists('/home/with space.txt'),true);assert.equal(fs.exists('/home/copied.txt'),false);
    const socket=new Socket('UDP',a);socket.bind(1234);assert.match(await terminal.executeCommand('netstat'),/UDP.*1234.*BOUND/);fs.mkdir('/home/folder');assert.ok(terminal.getCompletions('cd ').includes('cd folder/'));
    let captured='';terminal.onOutput(line=>captured+=line);const capture=terminal.executeCommand('tcpdump -c 1');await settle(networkStack.probe(a,b.getIP()));await capture;assert.match(captured,/ARP|ICMP/);
    const unbounded=terminal.executeCommand('tcpdump');terminal.interrupt();await unbounded;
    assert.equal((await terminal.executeCommand('route')).includes('192.168.1.0'),true);
});
await test('Router management serves actual routes/logs and POST firewall settings over TCP', async () => {
    const {a,r}=routed();const browser=new WebBrowser(a);assert.match((await settle(browser.navigate('http://192.168.1.1/routes'))).body,/192.168.2.0/);
    const response=await settle(browser.navigate('http://192.168.1.1/konfig','POST','enabled=on&rule=default-deny&action=allow'));assert.equal(response.status,200);assert.equal(r.isFirewallEnabled(),true);assert.equal(r.getFirewallRules()[0].action,'allow');
    assert.match((await settle(browser.navigate('http://192.168.1.1/log'))).body,/TCP/);browser.close();
});
await test('Wi-Fi SSID association carries genuine frames and changing SSID disconnects it', async () => {
    const a=host('10.0.0.1'),b=host('10.0.0.2'),ap=new Switch({type:'switch',ssid:'Classroom'});a.setWireless(true,'Classroom');
    const wired=cable(b,0,ap,0),nodes=[a,b,ap];const links=reconcileWireless(nodes,[wired]);assert.equal(links.length,2);assert.equal(links[1].isWireless(),true);
    networkStack.updateTopology(nodes,links);assert.equal((await settle(networkStack.probe(a,b.getIP()))).success,true);
    const data=new ScenarioManager().exportScenario(nodes,links);const restored=new ScenarioManager().importScenario(data);assert.equal((restored.nodes[0] as Host).getWireless().ssid,'Classroom');assert.ok(restored.cables.some(link=>link.isWireless()));
    ap.setSSID('Different');networkStack.updateTopology(nodes,reconcileWireless(nodes,links));assert.equal((await settle(networkStack.probe(a,b.getIP()))).success,false);
});
await test('Switch loops suppress duplicate Ethernet frames while TCP retransmissions remain possible', async () => {
    const a=host('10.0.0.1'),b=host('10.0.0.2'),s1=new Switch({type:'switch'}),s2=new Switch({type:'switch'}),s3=new Switch({type:'switch'});
    const links=[cable(a,0,s1,0),cable(s1,1,s2,0),cable(s2,1,s3,0),cable(s3,1,s1,2),cable(b,0,s3,2)];networkStack.updateTopology([a,b,s1,s2,s3],links);
    assert.equal((await settle(networkStack.probe(a,b.getIP()))).success,true);await advance(10000);assert.ok(links.every(link=>link.getActivePackets().length===0));
});
await test('Expired DHCP leases clear the address when renewal has no server', async () => {
    const a=host('0.0.0.0'),b=host('10.0.0.1');networkStack.updateTopology([a,b],[cable(a,0,b,0)]);const server=new DHCPServer(b.getIP(),{rangeStart:'10.0.0.10',rangeEnd:'10.0.0.20',router:'',dns:[],leaseTime:6},b);server.start();
    const client=new DHCPClient(a.getMAC(),'client',a),config=await settle(client.requestIP());a.getNetworkInterface().setIP(config.ip);server.stop();await advance(6500);assert.equal(a.getIP(),'0.0.0.0');client.cancel();
});
await test('POP3 locks the mailbox, rolls back abandoned deletion and commits only on QUIT', async () => {
    const {a,b}=routed();const server=new EmailServer(b);server.setMailDomain('mail.test');server.addAccount('bob','secret');server.start();
    const message=new Email();message.setFrom('alice@mail.test');message.addTo('bob@mail.test');message.setBody('Keep until QUIT');
    assert.equal((await settle(new SMTPClient(a).sendEmail(b.getIP(),message,'alice@mail.test',['bob@mail.test']))).success,true);
    const first=new POP3Client(a),second=new POP3Client(a);assert.equal((await settle(first.connect(b.getIP(),'bob','secret'))).success,true);
    assert.equal((await settle(second.connect(b.getIP(),'bob','secret'))).success,false);second.forceDisconnect();
    assert.equal((await settle(first.deleteMessage(1))).success,true);first.forceDisconnect();await advance(2000);
    const next=new POP3Client(a);assert.equal((await settle(next.connect(b.getIP(),'bob','secret'))).success,true);
    assert.equal((await settle(next.getStats())).data?.messageCount,1);await settle(next.deleteMessage(1));await settle(next.disconnect());
    assert.equal(server.getAccounts()[0].getMessageCount(),0);server.stop();
});
await test('Remote delivery failures return over SMTP and cannot teleport across a disconnected link', async () => {
    const {a,b,r,cables}=routed();const origin=hostEmailServerManager.getOrCreateServer(b),recipient=hostEmailServerManager.getOrCreateServer(a);
    origin.setMailDomain('relay.test');origin.start();recipient.setMailDomain('sender.test');recipient.addAccount('alice','secret');recipient.start();
    const dns=new DNSServer(b);dns.addRecord({name:'sender.test',type:DNSRecordType.MX,value:'sender.test',ttl:60});dns.addRecord({name:'sender.test',type:DNSRecordType.A,value:a.getIP(),ttl:60});dns.start();b.getNetworkInterface().setDNS(b.getIP());
    const message=new Email();message.setFrom('alice@sender.test');message.addTo('bob@missing.test');message.setSubject('Delivery failure');
    origin.sendBounce(message,'alice@sender.test',['bob@missing.test'],'Missing recipient');await advance(10000);assert.equal(recipient.getAccounts()[0].getMessageCount(),1);
    cables[0].disconnect();networkStack.updateTopology([a,b,r],[cables[1]]);
    origin.sendBounce(message,'alice@sender.test',['bob@missing.test'],'Disconnected');await advance(40000);assert.equal(recipient.getAccounts()[0].getMessageCount(),1);
    origin.sendBounce(message,'mailer-daemon@missing.test',['bob@missing.test'],'No bounce loop');await advance(1000);dns.stop();services.restore();
});
await test('Malformed firewall CIDRs and port ranges are rejected before changing rules or importing', () => {
    const router=new Vermittlungsrechner({type:'router'}),before=router.getFirewallRules();
    for(const updates of [{sourceIP:'10.0.0.1/33'},{sourceIP:'10.0.0.1/2x'},{destPort:'80foo'},{destPort:'1024-80'},{sourcePort:'65536'}]) assert.throws(()=>router.updateFirewallRule('default-deny',updates), /Firewall-Regel/);
    assert.deepEqual(router.getFirewallRules(),before);
    const manager=new ScenarioManager(),data=manager.exportScenario([router],[]);(data.nodes[0] as ReturnType<Vermittlungsrechner['toJSON']>).firewallRules![0].sourcePort='1-99999';assert.throws(()=>manager.importScenario(data), /Firewall-Regel/);
});
await test('Router DHCP binds to its LAN interface, excludes WAN broadcasts and persists', async () => {
    const lan=host('0.0.0.0'),wan=host('0.0.0.0'),router=new Vermittlungsrechner({type:'router',interfaces:[{ip:'10.0.0.1'},{ip:'192.168.0.1'}]});
    networkStack.updateTopology([lan,wan,router],[cable(lan,0,router,1),cable(wan,0,router,0)]);
    const server=hostDhcpServerManager.getOrCreateServer(router,{rangeStart:'192.168.0.100',rangeEnd:'192.168.0.110',subnetMask:'255.255.255.0',router:'192.168.0.1',dns:[],leaseTime:60},1);assert.equal(server.start(),true);
    const client=new DHCPClient(lan.getMAC(),'LAN',lan),assigned=await settle(client.requestIP());assert.equal(assigned.ip,'192.168.0.100');
    const packet=new Socket('UDP',wan);packet.bind(68);let offers=0;packet.onData(()=>offers++);packet.send({type:1,transactionId:123,clientMAC:wan.getMAC(),options:{}},{ip:'255.255.255.255',port:67});await advance(4000);assert.equal(offers,0);
    const state=services.snapshot([lan,wan,router]);assert.equal(state.dhcpServers[0].interfaceIndex,1);
    const scenario=new ScenarioManager().exportScenario([lan,wan,router],[], 'Router DHCP',state);new ScenarioManager().importScenario(scenario);
    client.cancel();services.restore(state,[lan,wan,router]);services.start();assert.equal(hostDhcpServerManager.getServer(router.getId())!.isRunning(),true);services.restore();
});
await test('Router interface 1 retransmits its management HTTP response after packet loss', async () => {
    const clientHost = host('192.168.2.10');
    const router = new Vermittlungsrechner({type:'router',interfaces:[{ip:'192.168.1.1',subnetMask:'255.255.255.0'},{ip:'192.168.2.1',subnetMask:'255.255.255.0'}]});
    networkStack.updateTopology([clientHost,router],[cable(clientHost,0,router,1)]);
    await advance(32);
    const nic=router.getInterface(1)!,send=nic.sendPacket.bind(nic);let dropped=false;
    nic.sendPacket=packet=>{if(!dropped&&packet.tcp?.flags.includes('PSH')){dropped=true;return;}send(packet);};
    const client=new Socket('TCP',clientHost);
    const response=new Promise<string>(resolve=>client.onData(message=>resolve(String(message.data))));
    client.onConnect(()=>client.send('GET /routes HTTP/1.1\r\nHost: router\r\n\r\n'));client.connect('192.168.2.1',80);
    assert.match(await settle(response),/200 OK/);assert.equal(dropped,true);
});
await test('Router active TCP open, bound address and lost FIN use interface 1', async () => {
    const serverHost=host('192.168.2.10');
    const router=new Vermittlungsrechner({type:'router',interfaces:[{ip:'192.168.1.1',subnetMask:'255.255.255.0'},{ip:'192.168.2.1',subnetMask:'255.255.255.0'}]});
    networkStack.updateTopology([serverHost,router],[cable(serverHost,0,router,1)]);
    const server=new Socket('TCP',serverHost);server.bind(1234);server.listen();server.onData(m=>server.send(m.data,m.source));
    let disconnects=0;server.onDisconnect(()=>disconnects++);
    const nic=router.getInterface(1)!,send=nic.sendPacket.bind(nic);let finCount=0;
    nic.sendPacket=packet=>{if(packet.tcp?.flags.includes('FIN')&&++finCount===1)return;send(packet);};
    const client=new Socket('TCP',router);assert.equal(client.bind(2345,'192.168.2.1'),true);
    const response=new Promise<string>(resolve=>client.onData(m=>resolve(String(m.data))));
    client.onConnect(()=>client.send('Router outbound'));client.connect(serverHost.getIP(),1234);
    assert.equal(await settle(response),'Router outbound');client.close();await advance(12000);
    assert.equal(finCount,2);assert.equal(disconnects,1);
});
await test('Router TCP keeps its bound source IP while routing through a different interface', async () => {
    const serverHost=host('192.168.2.10','192.168.2.1');
    const router=new Vermittlungsrechner({type:'router',interfaces:[{ip:'192.168.1.1',subnetMask:'255.255.255.0'},{ip:'192.168.2.1',subnetMask:'255.255.255.0'}]});
    networkStack.updateTopology([serverHost,router],[cable(serverHost,0,router,1)]);
    const server=new Socket('TCP',serverHost);server.bind(1234);server.listen();server.onData(m=>{assert.equal(m.source!.ip,'192.168.1.1');server.send(m.data,m.source);});
    const client=new Socket('TCP',router);client.bind(2345,'192.168.1.1');
    const response=new Promise<string>(resolve=>client.onData(m=>resolve(String(m.data))));
    client.onConnect(()=>client.send('Bound source, routed egress'));client.connect(serverHost.getIP(),1234);
    assert.equal(await settle(response),'Bound source, routed egress');
});
console.log = originalLog;
originalLog(`${passed} regression tests passed`);
