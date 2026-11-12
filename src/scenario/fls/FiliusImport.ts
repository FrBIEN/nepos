import type { ScenarioData, ServiceState } from '../ScenarioTypes';
import type { NetzwerkInterfaceConfig } from '../../hardware/NetzwerkInterface';
import type { FirewallRule } from '../../hardware/Vermittlungsrechner';
import { normalizeIP, generateMAC, ipToNumber, numberToIP } from '../../network/utils';
import { Bean, bean, prop, list, string, number, bool, decodeJavaBeans, type BeanValue } from './JavaBeansData';
export const JAVA_APPS: Record<string, string> = {
    'filius.software.lokal.Terminal': 'terminal', 'filius.software.lokal.ImageViewer': 'imageviewer', 'filius.software.lokal.FileExplorer': 'fileexplorer', 'filius.software.lokal.TextEditor': 'texteditor',
    'filius.software.dns.DNSServer': 'dnsserver', 'filius.software.email.EmailAnwendung': 'emailclient', 'filius.software.email.EmailServer': 'emailserver',
    'filius.software.clientserver.ServerBaustein': 'echoserver', 'filius.software.clientserver.ClientBaustein': 'simpleclient', 'filius.software.firewall.Firewall': 'firewall',
    'filius.software.dateiaustausch.PeerToPeerAnwendung': 'peertopeer', 'filius.software.www.WebServer': 'webserver', 'filius.software.www.WebBrowser': 'webbrowser'
};
export interface StoredFile {
    name: string;
    isDirectory: boolean;
    lastModified: string;
    content?: string;
    mimeType?: string;
    children?: Record<string, StoredFile>;
}
export const MIME: Record<string, string> = { html: 'text/html', htm: 'text/html', txt: 'text/plain', css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', ico: 'image/x-icon' };
const directory = (name: string): StoredFile => ({ name, isDirectory: true, lastModified: new Date(0).toISOString(), children: Object.create(null) });
function filesFromOS(os: BeanValue | undefined): StoredFile {
    const root = directory(''), legacyRoot = prop(prop(os, 'dateisystem'), 'arbeitsVerzeichnis');
    const visit = (tree: BeanValue, parent: StoredFile, depth: number) => {
        if (depth > 64)
            throw new Error('FLS-Dateibaum zu tief');
        const item = prop(tree, 'userObject');
        if (typeof item === 'string') {
            const name = item === 'webserver' ? 'web' : item;
            if (!name || name === '.' || name === '..' || /[\/\0]/.test(name))
                throw new Error('Ungültiger FLS-Ordner');
            const dir = directory(name);
            if (parent.children![name])
                throw new Error('Doppelter FLS-Dateiname');
            parent.children![name] = dir;
            for (const child of list(tree))
                visit(child!, dir, depth + 1);
        }
        else if (bean(item)) {
            const name = string(prop(item, 'name'));
            if (!name || name === '.' || name === '..' || /[\/\0]/.test(name))
                throw new Error('Ungültige FLS-Datei');
            const ext = string(prop(item, 'dateiTyp'), name.split('.').at(-1) ?? 'txt').toLowerCase();
            const mime = MIME[ext] ?? (ext.includes('/') ? ext : 'application/octet-stream');
            let content = string(prop(item, 'dateiInhalt'));
            if (mime.startsWith('image/') && mime !== 'image/svg+xml' && !content.startsWith('data:'))
                content = `data:${mime};base64,${content.replace(/\s/g, '')}`;
            if (parent.children![name])
                throw new Error('Doppelter FLS-Dateiname');
            parent.children![name] = { name, isDirectory: false, content, mimeType: mime, lastModified: new Date(0).toISOString() };
        }
        else
            for (const child of list(tree))
                visit(child!, parent, depth + 1);
    };
    if (legacyRoot)
        for (const tree of list(legacyRoot))
            visit(tree!, root, 0);
    root.children!.home ??= directory('home');
    root.children!.web ??= directory('web');
    return root;
}
function flatten(root: StoredFile, prefix = ''): Map<string, StoredFile> { const result = new Map<string, StoredFile>(); for (const file of Object.values(root.children ?? {})) {
    const path = `${prefix}/${file.name}`;
    result.set(path, file);
    if (file.isDirectory)
        for (const [p, f] of flatten(file, path))
            result.set(p, f);
} return result; }
function address(value: BeanValue | undefined) { const text = string(value, string(prop(value, 'mailAddress'), string(bean(value)?.args[0]))), match = /^(.*?)\s*<([^>]+)>$/.exec(text); return { displayName: match ? match[1].trim() : string(prop(value, 'displayName'), string(prop(value, 'name'))), mailAddress: match ? match[2] : text }; }
function email(value: BeanValue) { return { from: address(prop(value, 'absender')), to: list(prop(value, 'empfaenger')).map(address), cc: list(prop(value, 'cc')).map(address), bcc: list(prop(value, 'bcc')).map(address), subject: string(prop(value, 'betreff')), body: string(prop(value, 'text')), dateReceived: string(prop(value, 'dateReceived')), isNew: bool(prop(value, 'neu'), true), sent: bool(prop(value, 'versendet')) }; }
function account(value: BeanValue) { return { username: string(prop(value, 'benutzername')), password: string(prop(value, 'passwort')), firstName: string(prop(value, 'vorname')), lastName: string(prop(value, 'nachname')), emailAddress: string(prop(value, 'emailAdresse')), messages: list(prop(value, 'nachrichten')).map(email), pop3Server: string(prop(value, 'pop3server')), pop3Port: Number(string(prop(value, 'pop3port'), '110')), smtpServer: string(prop(value, 'smtpserver')), smtpPort: Number(string(prop(value, 'smtpport'), '25')) }; }
function legacyFirewallRule(value: BeanValue, index: number): FirewallRule {
    const b = bean(value)!;
    const names = ['srcIP', 'srcMask', 'destIP', 'destMask', 'port', 'protocol', 'action'];
    const fields = new Map(b.fields);
    names.forEach((key, i) => { if (!fields.has(key) && b.args[i] !== undefined)
        fields.set(key, b.args[i]); });
    const pattern = (ip: BeanValue | undefined, mask: BeanValue | undefined) => { const text = string(ip); if (!text)
        return 'any'; if (text === '999.999.999.999')
        throw new Error('Lokale Firewall-Netzwerkregel muss einem konkreten Netz zugeordnet werden'); const m = string(mask); return m ? `${text}/${ipToNumber(m).toString(2).split('1').length - 1}` : text; };
    const port = number(fields.get('port'), -1);
    return { id: `fls-rule-${index}`, enabled: true, action: number(fields.get('action')) === 1 ? 'allow' : 'deny', direction: 'both', protocol: ({ 1: 'icmp', 6: 'tcp', 17: 'udp' } as const)[number(fields.get('protocol'), 6) as 1 | 6 | 17] ?? 'any', sourceIP: pattern(fields.get('srcIP'), fields.get('srcMask')), destIP: pattern(fields.get('destIP'), fields.get('destMask')), destPort: port < 0 ? undefined : String(port) };
}
export function importFiliusXML(xml: string, name: string): {
    scenario: ScenarioData;
    warnings: string[];
} {
    const objects = decodeJavaBeans(xml), offset = typeof objects[0] === 'string' ? 1 : 0;
    if (!bean(objects[offset]) || !bean(objects[offset + 1]))
        throw new Error('FLS enthält keine Hardware-/Kabelliste');
    const state: ServiceState = { dhcpServers: [], dnsServers: [], webServers: [], echoServers: [], emailServers: [], emailClients: [], fileSystems: [], peerToPeer: [] };
    const scenario: ScenarioData = { version: '1.0', name, createdAt: new Date().toISOString(), nodes: [], cables: [], docElements: [], serviceState: state };
    const warnings = new Set<string>(), ports = new Map<Bean, {
        nodeId: string;
        portIndex: number;
    }>(), guiNodes = new Map<Bean, string>();
    for (const [index, item] of list(objects[offset]).entries()) {
        const hardware = bean(prop(item, 'knoten'));
        if (!hardware)
            throw new Error('FLS-Gerät ohne Hardware');
        const type = hardware.className.split('.').at(-1), id = `fls-node-${index + 1}`, os = prop(hardware, 'systemSoftware'), label = prop(item, 'imageLabel'), bounds = bean(prop(label, 'bounds'));
        const position = { x: number(bounds?.fields.get('x'), number(bounds?.args[0])) + number(bounds?.fields.get('width'), number(bounds?.args[2], 80)) / 2, y: number(bounds?.fields.get('y'), number(bounds?.args[1])) + number(bounds?.fields.get('height'), number(bounds?.args[3], 80)) / 2 };
        const name = string(prop(hardware, 'name'), string(prop(label, 'text'), `${type} ${index + 1}`));
        const nics = list(prop(hardware, 'netzwerkInterfaces')), localPorts = list(prop(hardware, 'anschluesse'));
        const count = type === 'Switch' ? (bean(prop(hardware, 'anschluesse'))?.className.startsWith('java.util.') ? localPorts.length : Math.max(24, nics.length, localPorts.length)) : type === 'Gateway' ? 2 : type === 'Vermittlungsrechner' ? Math.max(2, nics.length) : 1;
        const interfaces: NetzwerkInterfaceConfig[] = Array.from({ length: count }, (_, i) => { const nic = nics[i], port = bean(prop(nic, 'port')) ?? bean(localPorts[i]); if (port)
            ports.set(port, { nodeId: id, portIndex: i }); const cfg: NetzwerkInterfaceConfig = { ip: string(prop(nic, 'ip'), type === 'Gateway' && i === 0 ? '42.0.0.10' : '192.168.0.10'), subnetMask: string(prop(nic, 'subnetzMaske'), type === 'Gateway' && i === 0 ? '255.0.0.0' : '255.255.255.0'), gateway: string(prop(nic, 'gateway')), dns: string(prop(nic, 'dns')), mac: string(prop(nic, 'mac'), generateMAC()), useDHCP: bool(prop(os, 'DHCPKonfiguration')) }; return cfg; });
        const base = { id, name, position };
        guiNodes.set(bean(item)!, id);
        const apps = bean(prop(os, 'installierteAnwendungen'))?.entries ?? new Map<string, BeanValue>();
        if (type === 'Switch')
            scenario.nodes.push({ ...base, type: 'switch', portCount: count, ports: interfaces, ssid: string(prop(os, 'SSID'), `Nepos-${id}`) });
        else if (type === 'Modem') {
            scenario.nodes.push({ ...base, type: 'modem', networkInterface: interfaces[0] });
            warnings.add('Java-Modemverbindungen werden als Nepos-WebRTC-Modems übernommen und müssen neu verbunden werden.');
        }
        else if (type === 'Vermittlungsrechner' || type === 'Gateway') {
            const firewall = apps.get('filius.software.firewall.Firewall') ?? apps.get('filius.software.nat.NatGateway') ?? prop(os, 'firewall');
            const routes = list(prop(prop(os, 'weiterleitungstabelle'), 'manuelleTabelle')).map(row => { const r = list(row), interfaceIndex = interfaces.findIndex(n => n.ip === string(r[3])); if (interfaceIndex < 0)
                throw new Error('FLS-Route verweist auf unbekannte Schnittstelle'); return { network: string(r[0]), subnetMask: string(r[1]), gateway: string(r[2]), interfaceIndex, metric: 1 }; });
            // Include direct routes: the web router treats a saved route list as authoritative.
            interfaces.forEach((n, i) => routes.push({ network: numberToIP((ipToNumber(n.ip!) & ipToNumber(n.subnetMask!)) >>> 0), subnetMask: n.subnetMask!, gateway: '0.0.0.0', interfaceIndex: i, metric: 0 }));
            const rules = list(prop(firewall, 'ruleset')).map(legacyFirewallRule);
            rules.push({ id: 'fls-default', enabled: true, action: number(prop(firewall, 'defaultPolicy')) === 1 ? 'allow' : 'deny', direction: 'both', protocol: 'any', sourceIP: 'any', destIP: 'any' });
            scenario.nodes.push({ ...base, type: 'router', interfaces, routes, natEnabled: type === 'Gateway', wanInterface: 0, ripEnabled: bool(prop(os, 'ripEnabled')), ipForwardingEnabled: bool(prop(os, 'ipForwardingEnabled'), true), firewallEnabled: bool(prop(firewall, 'activated')), firewallRules: rules, portForwards: list(prop(os, 'staticNAT')).map(row => { const r = list(row); return { protocol: string(r[0]).toLowerCase() as 'tcp' | 'udp', externalPort: Number(string(r[1])), internalIP: string(r[2]), internalPort: Number(string(r[3])) }; }) });
            const dhcp = prop(os, 'DHCPServer'), lower = string(prop(dhcp, 'untergrenze')), upper = string(prop(dhcp, 'obergrenze'));
            if (lower && upper) {
                const index = type === 'Gateway' ? 1 : 0, iface = interfaces[index];
                state.dhcpServers.push({ hostId: id, interfaceIndex: index, running: bool(prop(dhcp, 'aktiv')), config: { rangeStart: lower, rangeEnd: upper, subnetMask: iface.subnetMask!, router: string(prop(dhcp, 'gatewayip'), iface.ip), dns: [string(prop(dhcp, 'dnsserverip'), iface.dns)].filter(Boolean), leaseTime: 86400 }, reservations: list(prop(dhcp, 'staticAssignedAddresses')).map(value => { const [mac, ip] = string(value).split(/\s+/); return { mac, ip }; }) });
            }
        }
        else if (type === 'Rechner' || type === 'Notebook') {
            const installedApps = ['terminal', 'softwarewizard', ...Array.from(apps.keys()).map(key => { if (!JAVA_APPS[key])
                    warnings.add(`Java-Erweiterungsprogramm wird nicht ausgeführt: ${key}`); return JAVA_APPS[key]; }).filter(Boolean)];
            const firewall = apps.get('filius.software.firewall.Firewall');
            const hostRules = list(prop(firewall, 'ruleset')).map((v) => { const f = bean(v)!; return { protocol: number(f.fields.get('protocol'), number(f.args[5], 6)) === 17 ? 'udp' as const : 'tcp' as const, port: number(f.fields.get('port'), number(f.args[4])), localOnly: string(f.fields.get('srcIP'), string(f.args[0])) === '999.999.999.999' }; }).filter(r => r.port > 0);
            scenario.nodes.push({ ...base, type: type === 'Notebook' ? 'notebook' : 'rechner', networkInterface: interfaces[0], installedApps: [...new Set(installedApps)], useIPAsName: bool(prop(hardware, 'useIPAsName')), wireless: { enabled: bool(prop(nics[0], 'wireless')), ssid: string(prop(os, 'ssid')) }, firewall: { enabled: !!firewall && bool(prop(firewall, 'activated'), true), blockICMP: bool(prop(firewall, 'dropICMP')), rules: hostRules } });
            const root = filesFromOS(os), files = flatten(root);
            state.fileSystems!.push({ hostId: id, fsState: root });
            for (const [clazz, app] of apps) {
                const kind = JAVA_APPS[clazz], running = bool(prop(app, 'aktiv'));
                if (kind === 'webserver')
                    state.webServers!.push({ hostId: id, running, port: number(prop(app, 'port'), 80), files: Array.from(files.entries()).filter(([p, f]) => p.startsWith('/web/') && !f.isDirectory).map(([p, f]) => ({ name: p.slice(5), content: f.content ?? '', mimeType: f.mimeType ?? 'text/plain', lastModified: new Date(f.lastModified) })) });
                if (kind === 'dnsserver') {
                    const records = [];
                    for (const line of (files.get('/dns/hosts')?.content ?? '').split('\n')) {
                        if (!line.trim() || line.trim().startsWith('#'))
                            continue;
                        const parts = line.trim().split(/\s+/), type = ({ A: 1, NS: 2, CNAME: 5, PTR: 12, MX: 15, TXT: 16 } as Record<string, number>)[parts[1]?.toUpperCase()];
                        if (!type || parts.length < 4)
                            throw new Error('Nicht unterstützter DNS-Eintrag im FLS-Projekt');
                        records.push({ name: parts[0] === '.' ? '.' : parts[0].replace(/\.$/, ''), type, ttl: Number(parts[2]), value: parts.slice(3).join(' ').replace(/\.$/, '') });
                    }
                    state.dnsServers!.push({ hostId: id, running, records });
                }
                if (kind === 'echoserver')
                    state.echoServers!.push({ hostId: id, running, port: number(prop(app, 'port'), 55555) });
                if (kind === 'emailserver') {
                    const domain = string(prop(app, 'mailDomain'), 'filius.de'), accounts = list(prop(app, 'listeBenutzerkonten')).map(account);
                    state.emailServers!.push({ hostId: id, running, serverState: { mailDomain: domain, accounts: accounts.map(a => ({ key: a.username, account: { ...a, emailAddress: a.emailAddress || `${a.username}@${domain}` } })) } });
                }
                if (kind === 'emailclient') {
                    const a = Array.from(bean(prop(app, 'kontoListe'))?.entries.values() ?? [])[0], csv = files.get('/konten.txt')?.content?.trim().split(';');
                    const saved = a ? account(a) : csv && csv.length >= 9 ? { pop3Server: csv[0], smtpServer: csv[1], pop3Port: Number(csv[2]), smtpPort: Number(csv[3]), username: csv[4], password: csv[5], lastName: csv[6], firstName: csv[7], emailAddress: csv[8], messages: [] } : null;
                    state.emailClients!.push({ hostId: id, clientState: { account: saved, inbox: list(prop(app, 'empfangeneNachrichten')).map(email), sent: list(prop(app, 'gesendeteNachrichten')).map(email), drafts: list(prop(app, 'erstellteNachrichten')).map(email) } });
                }
                if (kind === 'peertopeer') {
                    state.peerToPeer!.push({ hostId: id, running, shares: [], peers: [] });
                    if (bean(app)?.properties.size)
                        warnings.add('Gnutella-Verbindungen müssen in Nepos neu aufgebaut werden.');
                }
            }
            const dhcp = prop(os, 'DHCPServer'), lower = string(prop(dhcp, 'untergrenze')), upper = string(prop(dhcp, 'obergrenze'));
            if (lower && upper && normalizeIP(lower) && normalizeIP(upper)) {
                (scenario.nodes.at(-1) as {
                    installedApps?: string[];
                }).installedApps!.push('dhcpserver');
                state.dhcpServers.push({ hostId: id, running: bool(prop(dhcp, 'aktiv')), config: { rangeStart: lower, rangeEnd: upper, subnetMask: interfaces[0].subnetMask!, router: string(prop(dhcp, 'gatewayip'), interfaces[0].gateway), dns: [string(prop(dhcp, 'dnsserverip'), interfaces[0].dns)].filter(Boolean), leaseTime: 86400 }, reservations: list(prop(dhcp, 'staticAssignedAddresses')).map(value => { const [mac, ip] = string(value).split(/\s+/); return { mac, ip }; }) });
            }
        }
        else
            throw new Error(`Nicht unterstützte FLS-Hardware: ${type}`);
    }
    for (const [i, item] of list(objects[offset + 1]).entries()) {
        const cable = prop(item, 'dasKabel'), ends = list(prop(cable, 'anschluesse')), panel = prop(item, 'kabelpanel');
        const endpoints = ends.map(p => ports.get(bean(p)!));
        if (endpoints.length !== 2 || endpoints.some(p => !p))
            throw new Error('FLS-Kabelanschluss nicht gefunden');
        const guis = [guiNodes.get(bean(prop(panel, 'ziel1'))!), guiNodes.get(bean(prop(panel, 'ziel2'))!)];
        if (guis.some((id, j) => id && id !== endpoints[j]!.nodeId))
            throw new Error('FLS-Kabel und Darstellung widersprechen sich');
        scenario.cables.push({ id: `fls-cable-${i + 1}`, endpoint1: endpoints[0]!, endpoint2: endpoints[1]!, wireless: bool(prop(cable, 'wireless')) });
    }
    for (const [i, item] of list(objects[offset + 2]).entries()) {
        const color = bean(prop(item, 'color')), rgba = color?.args.length ? color.args : [0, 0, 0];
        const hex = '#' + rgba.slice(0, 3).map(c => Math.max(0, Math.min(255, number(c))).toString(16).padStart(2, '0')).join('');
        scenario.docElements!.push({ id: `fls-doc-${i + 1}`, type: number(prop(item, 'type')) === 1 ? 'rectangle' : 'textbox', text: string(prop(item, 'text')), position: { x: number(prop(item, 'x')), y: number(prop(item, 'y')) }, width: number(prop(item, 'width'), 200), height: number(prop(item, 'height'), 80), color: hex });
    }
    // Reconcile the Java Wi-Fi association with its persisted physical endpoint.
    for (const link of scenario.cables)
        if (link.wireless) {
            const host = scenario.nodes.find(n => ['rechner', 'notebook'].includes(n.type) && [link.endpoint1.nodeId, link.endpoint2.nodeId].includes(n.id!));
            const ap = scenario.nodes.find(n => n.type === 'switch' && [link.endpoint1.nodeId, link.endpoint2.nodeId].includes(n.id!));
            if (host && ap) {
                (host as {
                    wireless: {
                        enabled: boolean;
                        ssid: string;
                    };
                }).wireless = { enabled: true, ssid: (ap as {
                        ssid: string;
                    }).ssid };
            }
        }
    return { scenario, warnings: [...warnings] };
}
