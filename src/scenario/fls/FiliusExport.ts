import type { ScenarioData, ServiceState } from '../ScenarioTypes';
import type { NetzwerkInterfaceConfig } from '../../hardware/NetzwerkInterface';
import type { FirewallRule } from '../../hardware/Vermittlungsrechner';
import { numberToIP } from '../../network/utils';
import { JAVA_APPS, type StoredFile } from './FiliusImport';
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uD800-\uDFFF\uFFFE\uFFFF]/g, char => `<char code="#${char.charCodeAt(0).toString(16)}"/>`);
const str = (text: string) => `<string>${escape(text)}</string>`;
const int = (n: number) => `<int>${Math.round(n)}</int>`;
const boolean = (value: boolean) => `<boolean>${value}</boolean>`;
const property = (name: string, value: string, id?: string) => `<void property="${name}"${id ? ` id="${id}"` : ''}>${value}</void>`;
const object = (className: string, body = '', id?: string, args = '') => `<object class="${className}"${id ? ` id="${id}"` : ''}>${args}${body}</object>`;
const ref = (id: string) => `<object idref="${id}"/>`;
const javaList = (values: string[], className = 'java.util.LinkedList') => object(className, values.map(value => `<void method="add">${value}</void>`).join(''));
const strings = (values: string[]) => javaList(values.map(str));
const stringArray = (values: string[]) => `<array class="java.lang.String" length="${values.length}">${values.map((v, i) => `<void index="${i}">${str(v)}</void>`).join('')}</array>`;
const appClass = Object.fromEntries(Object.entries(JAVA_APPS).map(([clazz, id]) => [id, clazz]));
interface SavedAddress {
    displayName?: string;
    mailAddress: string;
}
interface SavedEmail {
    from: SavedAddress | null;
    to: SavedAddress[];
    cc?: SavedAddress[];
    bcc?: SavedAddress[];
    subject: string;
    body: string;
    dateReceived?: string;
    isNew?: boolean;
    sent?: boolean;
}
interface SavedAccount {
    username: string;
    password: string;
    firstName?: string;
    lastName?: string;
    emailAddress?: string;
    messages?: SavedEmail[];
    pop3Server?: string;
    pop3Port?: number;
    smtpServer?: string;
    smtpPort?: number;
}
const address = (a: SavedAddress) => object('filius.software.email.AddressEntry', property('name', str(a.displayName ?? '')) + property('mailAddress', str(a.mailAddress)));
function email(value: SavedEmail): string { return object('filius.software.email.Email', property('absender', value.from ? address(value.from) : '<null/>') + property('empfaenger', javaList(value.to.map(address))) + property('cc', javaList((value.cc ?? []).map(address))) + property('bcc', javaList((value.bcc ?? []).map(address))) + property('betreff', str(value.subject)) + property('text', str(value.body)) + property('dateReceived', str(value.dateReceived ?? '')) + property('neu', boolean(value.isNew ?? true)) + property('versendet', boolean(value.sent ?? false))); }
function account(value: SavedAccount): string { return object('filius.software.email.EmailKonto', property('benutzername', str(value.username)) + property('passwort', str(value.password)) + property('vorname', str(value.firstName ?? '')) + property('nachname', str(value.lastName ?? '')) + property('emailAdresse', str(value.emailAddress ?? '')) + property('pop3server', str(value.pop3Server ?? '')) + property('pop3port', str(String(value.pop3Port ?? 110))) + property('smtpserver', str(value.smtpServer ?? '')) + property('smtpport', str(String(value.smtpPort ?? 25))) + property('nachrichten', javaList((value.messages ?? []).map(email)))); }
function fileTree(node: StoredFile): string {
    const name = node.name === 'web' ? 'webserver' : node.name;
    const body = node.isDirectory ? property('userObject', str(name)) + Object.values(node.children ?? {}).map(child => `<void method="add">${fileTree(child)}</void>`).join('') : property('userObject', object('filius.software.system.Datei', property('name', str(name)) + property('dateiTyp', str(node.mimeType ?? 'text/plain')) + property('dateiInhalt', str((node.content ?? '').replace(/^data:[^;]+;base64,/, '')))));
    return object('javax.swing.tree.DefaultMutableTreeNode', body);
}
function color(value: string): string { let channels = [0, 0, 0, 255]; if (/^#[a-f\d]{6}$/i.test(value))
    channels = [...value.slice(1).match(/../g)!.map(h => parseInt(h, 16)), 255];
else {
    const match = /rgba?\(([^)]+)\)/.exec(value);
    if (match) {
        const n = match[1].split(',').map(Number);
        channels = [n[0], n[1], n[2], n.length === 4 ? Math.round(n[3] * 255) : 255];
    }
} return object('java.awt.Color', '', undefined, channels.map(int).join('')); }
function javaRule(src: string, srcMask: string, dest: string, destMask: string, port: number, protocol: number, action: number): string { return object('filius.software.firewall.FirewallRule', '', undefined, str(src) + str(srcMask) + str(dest) + str(destMask) + int(port) + `<short>${protocol}</short><short>${action}</short>`); }
function firewallRules(rules: FirewallRule[], warnings: Set<string>): string[] {
    const pattern = (value: string): [
        string,
        string
    ] => { if (value === 'any')
        return ['', '']; const [ip, bits] = value.split('/'); return [ip, bits === undefined ? '' : numberToIP(Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0)]; };
    const result: string[] = [];
    for (const rule of rules) {
        if (!rule.enabled) {
            warnings.add('Deaktivierte Router-Firewall-Regeln bleiben nur in der Nepos-Erweiterung erhalten.');
            continue;
        }
        if (rule.direction !== 'both' || rule.sourcePort || rule.destPort?.includes('-')) {
            warnings.add('Richtungsregeln, Quellports und Portbereiche der Router-Firewall bleiben in der Nepos-Erweiterung; Java-Filius unterstützt diese Regelattribute nicht.');
            continue;
        }
        const [source, sourceMask] = pattern(rule.sourceIP), [dest, destMask] = pattern(rule.destIP);
        result.push(javaRule(source, sourceMask, dest, destMask, rule.destPort ? Number(rule.destPort) : -1, ({ any: -1, icmp: 1, tcp: 6, udp: 17 })[rule.protocol], rule.action === 'allow' ? 1 : 0));
    }
    return result;
}
export function exportFiliusXML(scenario: ScenarioData): {
    xml: string;
    warnings: string[];
} {
    const warnings = new Set<string>(), state: Partial<ServiceState> = scenario.serviceState ?? {}, portIds = new Map<string, string>(), guiIds = new Map<string, string>();
    const hasBinary = (node: any): boolean => node?.encoding === 'data-url' || Object.values(node?.children ?? {}).some(hasBinary);
    if (state.fileSystems?.some(file => hasBinary(file.fsState))) warnings.add('Binärdateien bleiben verlustfrei in der Nepos-Erweiterung erhalten; ihre Darstellung in Java-Filius hängt vom Dateityp ab.');
    if (state.editorSessions?.some(session=>session.tabs.some(tab=>tab.isDirty))) warnings.add('Ungespeicherte Textentwürfe bleiben in der Nepos-Erweiterung erhalten; Java-Filius zeigt sie nicht als Dateien an.');
    if (scenario.description) warnings.add('Die Projektbeschreibung bleibt in der Nepos-Erweiterung erhalten.');
    const hardware = scenario.nodes.map((node, index) => {
        const guiId = `gui${index}`, hwId = `hardware${index}`, osId = `os${index}`, id = node.id!;
        guiIds.set(id, guiId);
        const type = node.type === 'notebook' ? 'Notebook' : node.type === 'rechner' ? 'Rechner' : node.type === 'switch' ? 'Switch' : node.type === 'modem' ? 'Modem' : node.type === 'router' && node.natEnabled ? 'Gateway' : 'Vermittlungsrechner';
        const ifaces: NetzwerkInterfaceConfig[] = node.type === 'router' ? node.interfaces ?? [] : node.type === 'switch' ? node.ports ?? Array.from({ length: node.portCount ?? 8 }, () => ({})) : [node.networkInterface ?? {}];
        let ports: string;
        if (type === 'Switch' || type === 'Modem') {
            ports = property('anschluesse', javaList(ifaces.map((_, i) => { const p = `port${index}_${i}`; portIds.set(`${id}:${i}`, p); return object('filius.hardware.Port', '', p); })));
            if (type === 'Modem')
                warnings.add('WebRTC-Verbindungen und ICE-Einstellungen bleiben Nepos-spezifisch; Java-Modems verwenden einen anderen Verbindungstyp.');
        }
        else
            ports = property('netzwerkInterfaces', javaList(ifaces.map((iface, i) => { const p = `port${index}_${i}`; portIds.set(`${id}:${i}`, p); return object('filius.hardware.NetzwerkInterface', property('ip', str(iface.ip ?? '192.168.0.10')) + property('subnetzMaske', str(iface.subnetMask ?? '255.255.255.0')) + property('gateway', str(iface.gateway ?? '')) + property('dns', str(iface.dns ?? '')) + (iface.mac ? property('mac', str(iface.mac)) : '') + property('wireless', boolean((node.type === 'rechner' || node.type === 'notebook') && !!node.wireless?.enabled)) + `<void property="port" id="${p}"/>`, undefined, ref(hwId)); })));
        let osBody = '';
        const apps: string[] = [];
        const fsState = state.fileSystems?.find(s => s.hostId === id)?.fsState as StoredFile | undefined;
        if (node.type === 'rechner' || node.type === 'notebook') {
            const fs: StoredFile = fsState ? structuredClone(fsState) : { name: '', isDirectory: true, lastModified: new Date(0).toISOString(), children: Object.create(null) };
            fs.children ??= Object.create(null);
            const addFile = (path: string, content: string) => { let dir = fs; const parts = path.split('/').filter(Boolean), name = parts.pop()!; for (const part of parts) {
                dir.children ??= Object.create(null);
                dir.children![part] ??= { name: part, isDirectory: true, lastModified: new Date(0).toISOString(), children: Object.create(null) };
                dir = dir.children![part];
            } dir.children ??= Object.create(null); dir.children![name] = { name, isDirectory: false, content, mimeType: 'text/plain', lastModified: new Date(0).toISOString() }; };
            const dns = state.dnsServers?.find(s => s.hostId === id);
            if (dns)
                addFile('/dns/hosts', dns.records.map(r => `${r.name} ${({ 1: 'A', 2: 'NS', 5: 'CNAME', 12: 'PTR', 15: 'MX', 16: 'TXT' } as Record<number, string>)[r.type]} ${r.ttl} ${r.value}`).join('\n') + '\n');
            const mailClient = state.emailClients?.find(s => s.hostId === id)?.clientState as {
                account?: SavedAccount;
                inbox?: SavedEmail[];
                sent?: SavedEmail[];
                drafts?: SavedEmail[];
            } | undefined;
            if (mailClient?.account) {
                const a = mailClient.account;
                addFile('/konten.txt', `${a.pop3Server ?? ''};${a.smtpServer ?? ''};${a.pop3Port ?? 110};${a.smtpPort ?? 25};${a.username};${a.password};${a.lastName ?? ''};${a.firstName ?? ''};${a.emailAddress ?? ''}`);
            }
            const mailServer = state.emailServers?.find(s => s.hostId === id), serverState = mailServer?.serverState as {
                mailDomain: string;
                accounts: {
                    key: string;
                    account: SavedAccount;
                }[];
            } | undefined;
            if (serverState)
                addFile('/mailserver/konten.txt', serverState.accounts.map(({ account: a }) => `${a.username};${serverState.mailDomain};${a.password};${a.lastName ?? ''};${a.firstName ?? ''};`).join('\n') + '\n');
            const web = state.webServers?.find(s => s.hostId === id);
            if (web)
                for (const file of web.files) {
                    const name=file.name.replace(/^\/+/, '');
                    if(!name || name.split('/').some(part=>!part || part==='.' || part==='..' || part.includes('\0')))throw new Error('Ungültiger Webdateipfad');
                    addFile('/web/' + name, file.content);
                    let dir = fs.children!.web;
                    for (const part of name.split('/').slice(0, -1))
                        dir = dir.children![part];
                    dir.children![name.split('/').at(-1)!].mimeType = file.mimeType;
                }
            osBody += property('DHCPKonfiguration', boolean(ifaces[0].useDHCP ?? false)) + property('ssid', str(node.wireless?.ssid ?? '')) + property('dateisystem', property('arbeitsVerzeichnis', Object.values(fs.children!).map(child => `<void method="add">${fileTree(child)}</void>`).join('')));
            for (const app of node.installedApps ?? ['terminal', 'webbrowser']) {
                const clazz = appClass[app];
                if (!clazz) {
                    if (!['softwarewizard','dhcpserver'].includes(app)) warnings.add('Anwendung „' + app + '“ bleibt nur in der Nepos-Erweiterung erhalten.');
                    continue;
                }
                let body = '';
                let running = false;
                if (app === 'webserver') {
                    running = web?.running ?? false;
                    body += property('port', int(web?.port ?? 80));
                }
                if (app === 'dnsserver')
                    running = dns?.running ?? false;
                if (app === 'echoserver') {
                    const echo = state.echoServers?.find(s => s.hostId === id);
                    running = echo?.running ?? false;
                    body += property('port', int(echo?.port ?? 55555));
                }
                if (app === 'emailserver') {
                    running = mailServer?.running ?? false;
                    if (serverState)
                        body += property('mailDomain', str(serverState.mailDomain)) + property('listeBenutzerkonten', javaList(serverState.accounts.map(a => account(a.account))));
                }
                if (app === 'emailclient' && mailClient)
                    body += property('empfangeneNachrichten', javaList((mailClient.inbox ?? []).map(email))) + property('gesendeteNachrichten', javaList((mailClient.sent ?? []).map(email))) + property('erstellteNachrichten', javaList((mailClient.drafts ?? []).map(email)));
                if (app === 'firewall') {
                    const firewall = node.firewall;
                    body += property('activated', boolean(firewall?.enabled ?? false)) + property('dropICMP', boolean(firewall?.blockICMP ?? false)) + property('ruleset', javaList((firewall?.rules ?? []).map(r => javaRule(r.localOnly ? '999.999.999.999' : '', '', '', '', r.port, r.protocol === 'tcp' ? 6 : 17, 1)), 'java.util.Vector'));
                }
                if (app === 'peertopeer' && state.peerToPeer?.some(s => s.hostId === id)) {
                    warnings.add('Peer-Verbindungen und Freigabelisten werden in der Nepos-Erweiterung erhalten; Java-Gnutella verwendet ein anderes Protokoll.');
                }
                apps.push(`<void method="put">${str(clazz)}${object(clazz, body + (['webserver', 'dnsserver', 'echoserver', 'emailserver'].includes(app) ? property('aktiv', boolean(running)) : '') + property('systemSoftware', ref(osId)))}</void>`);
            }
        }
        else if (node.type === 'router') {
            osBody += property('ipForwardingEnabled', boolean(node.ipForwardingEnabled ?? true));
            if (type !== 'Gateway')
                osBody += property('ripEnabled', boolean(node.ripEnabled ?? false)) + property('weiterleitungstabelle', property('manuelleTabelle', javaList((node.routes ?? []).filter(r => r.metric > 0).map(r => stringArray([r.network, r.subnetMask, r.gateway, node.interfaces![r.interfaceIndex].ip!])))));
            else
                osBody += property('staticNAT', javaList((node.portForwards ?? []).map(p => stringArray([p.protocol.toUpperCase(), String(p.externalPort), p.internalIP, String(p.internalPort)]))));
            if (type === 'Gateway' && (node.ripEnabled || node.routes?.some(route=>route.metric>0))) warnings.add('RIP und manuelle Routen des NAT-Routers bleiben in der Nepos-Erweiterung erhalten.');
            if (type !== 'Gateway' && node.portForwards?.length) warnings.add('Portweiterleitungen ohne aktiviertes NAT bleiben in der Nepos-Erweiterung erhalten.');
            const rules = firewallRules(node.firewallRules ?? [], warnings);
            const firewall = property('activated', boolean(node.firewallEnabled ?? false)) + property('ruleset', javaList(rules, 'java.util.Vector'));
            osBody += property('installierteAnwendungen', `<void method="get">${str(type === 'Gateway' ? 'filius.software.nat.NatGateway' : 'filius.software.firewall.Firewall')}${firewall}</void>`);
            if (node.natEnabled && (node.wanInterface ?? 0) !== 0)
                warnings.add('Java-Heimrouter verwenden Anschluss 0 als WAN; die andere Nepos-WAN-Zuordnung bleibt in der Erweiterung.');
        }
        else if (node.type === 'switch')
            osBody += property('SSID', str(node.ssid ?? node.name ?? 'Nepos'));
        const dhcp = state.dhcpServers?.find(s => s.hostId === id);
        if (dhcp?.config) {
            const c = dhcp.config;
            osBody += property('DHCPServer', property('aktiv', boolean(dhcp.running)) + property('untergrenze', str(c.rangeStart)) + property('obergrenze', str(c.rangeEnd)) + property('ownSettings', boolean(true)) + property('gatewayip', str(c.router)) + property('dnsserverip', str(c.dns[0] ?? '')) + property('staticAssignedAddresses', strings((dhcp.reservations ?? []).map(r => `${r.mac} ${r.ip}`))));
            if (c.dns.length > 1 || c.leaseTime !== 86400)
                warnings.add('Mehrere DNS-Adressen und eigene DHCP-Leasezeiten bleiben in der Nepos-Erweiterung erhalten.');
        }
        if (apps.length)
            osBody += property('installierteAnwendungen', apps.join(''));
        const x = Math.round(node.position?.x ?? 0) - 40, y = Math.round(node.position?.y ?? 0) - 40;
        const label = object('filius.gui.netzwerksicht.JSidebarButton', property('bounds', object('java.awt.Rectangle', '', undefined, [x, y, 80, 80].map(int).join(''))) + property('text', str(node.name ?? type)) + property('typ', str(type)));
        const name = property('name', str(node.name ?? type));
        const os = property('systemSoftware', osBody, osId);
        return object('filius.gui.netzwerksicht.GUIKnotenItem', property('imageLabel', label) + property('knoten', object('filius.hardware.knoten.' + type, name + ports + os + ((node.type === 'rechner' || node.type === 'notebook') ? property('useIPAsName', boolean(node.useIPAsName ?? false)) : ''), hwId)), guiId);
    });
    const cables = scenario.cables.map(c => { const ends = [c.endpoint1, c.endpoint2]; const ports = ends.map(e => portIds.get(`${e.nodeId}:${e.portIndex}`)); if (ports.some(p => !p))
        throw new Error('FLS-Export: Kabelanschluss fehlt'); return object('filius.gui.netzwerksicht.GUIKabelItem', property('dasKabel', object('filius.hardware.Kabel', property('anschluesse', `<array class="filius.hardware.Port" length="2">${ports.map((p, i) => `<void index="${i}">${ref(p!)}</void>`).join('')}</array>`) + property('wireless', boolean(c.wireless ?? false)))) + property('kabelpanel', property('ziel1', ref(guiIds.get(ends[0].nodeId)!)) + property('ziel2', ref(guiIds.get(ends[1].nodeId)!)))); });
    const documents = (scenario.docElements ?? []).map(d => object('filius.gui.netzwerksicht.GUIDocuItem', property('type', int(d.type === 'rectangle' ? 1 : 2)) + property('text', d.type === 'rectangle' ? '<null/>' : str(d.text)) + property('x', int(d.position.x)) + property('y', int(d.position.y)) + property('width', int(d.width)) + property('height', int(d.height)) + property('color', color(d.color)) + property('font', object('java.awt.Font', '', undefined, str('SansSerif') + int(0) + int(14)))));
    return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n<java version="17" class="java.beans.XMLDecoder">${str('Filius version: 2.9.4 (Nepos export)')}${javaList(hardware)}${javaList(cables)}${javaList(documents, 'java.util.ArrayList')}</java>`, warnings: [...warnings] };
}
