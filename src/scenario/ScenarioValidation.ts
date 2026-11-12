import { normalizeIP, isValidSubnetMask, isValidMAC, sameNetwork, ipToNumber, isValidIPPattern, isValidPortPattern } from '../network/utils';
import type { ScenarioData } from './ScenarioManager';

/** Validate the complete topology before constructing any objects or changing the active project. */
export function validateScenario(value: unknown): asserts value is ScenarioData {
    const fail = (text: string): never => { throw new Error(`Ungültige Projektdatei: ${text}`); };
    const object = (x: any): boolean => !!x && typeof x === 'object' && !Array.isArray(x);
    const text = (x: any, max = 4096): boolean => typeof x === 'string' && x.length <= max;
    const list = (x: any, max = 10000): boolean => Array.isArray(x) && x.length <= max;
    const integer = (x: any, min: number, max: number) => Number.isInteger(x) && x >= min && x <= max;
    const date = (x: any) => typeof x === 'string' && x.length <= 64 && Number.isFinite(Date.parse(x));
    const ip = (x: any) => typeof x === 'string' && !!normalizeIP(x);
    const nic = (x: any) => {
        if (!object(x)) fail('Netzwerkschnittstelle');
        if (x.mac !== undefined && (!text(x.mac) || !isValidMAC(x.mac))) fail('MAC-Adresse');
        if (x.ip !== undefined && !ip(x.ip)) fail('IP-Adresse');
        if (x.subnetMask !== undefined && (!text(x.subnetMask) || !isValidSubnetMask(x.subnetMask))) fail('Netzmaske');
        if(x.useDHCP!==undefined && typeof x.useDHCP!=='boolean')fail('DHCP-Status');
        for (const key of ['gateway', 'dns']) if (x[key] !== undefined && x[key] !== '' && !ip(x[key])) fail(key);
    };
    const data = value as any;
    if (!object(data) || data.version !== '1.0' || !list(data.nodes, 2048) || !list(data.cables, 8192)) fail('Version oder Topologie');
    if (!text(data.name) || (data.description !== undefined && !text(data.description,100000))) fail('Projektname oder Beschreibung');
    if (data.createdAt !== undefined && !date(data.createdAt)) fail('Erstellungsdatum');
    const ids = new Set<string>(), ports = new Map<string, number>(), hosts = new Set<string>();
    const checkId = (id: any) => { if (!text(id, 128) || !/^[\w-]+$/.test(id) || ids.has(id)) fail('fehlende oder doppelte ID'); ids.add(id); };
    for (const n of data.nodes) {
        if (!object(n)) fail('Gerät'); checkId(n.id);
        if (!['rechner', 'notebook', 'router', 'switch', 'modem'].includes(n.type)) fail('Gerätetyp');
        if (n.name !== undefined && !text(n.name)) fail('Gerätename');
        if (n.position && (!object(n.position) || !Number.isFinite(n.position.x) || !Number.isFinite(n.position.y))) fail('Position');
        if(n.wireless && (!object(n.wireless)||typeof n.wireless.enabled!=='boolean'||!text(n.wireless.ssid,32)||new TextEncoder().encode(n.wireless.ssid).length>32))fail('WLAN-Konfiguration');
        if(n.ssid!==undefined&&(!text(n.ssid,32)||!n.ssid.trim()||new TextEncoder().encode(n.ssid).length>32))fail('SSID');
        if (n.firewall) { if (!object(n.firewall) || typeof n.firewall.enabled !== 'boolean' || typeof n.firewall.blockICMP !== 'boolean' || !list(n.firewall.rules) || n.firewall.rules.some((r:any) => !object(r) || !['tcp','udp'].includes(r.protocol) || !integer(r.port,1,65535) || typeof r.localOnly !== 'boolean')) fail('Persönliche Firewall'); }
        if (n.color && (!text(n.color,7) || !/^#[0-9a-f]{6}$/i.test(n.color))) fail('Paketfarbe');
        for(const field of ['natEnabled','ripEnabled','firewallEnabled','ipForwardingEnabled','useIPAsName'])if(n[field]!==undefined&&typeof n[field]!=='boolean')fail(field);
        let count = 1;
        if (n.networkInterface) nic(n.networkInterface);
        if (n.type === 'switch') { count = n.portCount ?? 8; if (!integer(count, 2, 64) || (n.ports && (!list(n.ports, count) || n.ports.length !== count))) fail('Switch-Ports'); n.ports?.forEach(nic); }
        if (n.type === 'router') {
            count = n.interfaces?.length ?? 2; if (!integer(count, 2, 8)) fail('Router-Schnittstellen'); if(n.interfaces && !list(n.interfaces,8))fail('Router-Schnittstellen'); n.interfaces?.forEach(nic);
            if (n.wanInterface !== undefined && !integer(n.wanInterface, 0, count - 1)) fail('WAN-Schnittstelle');
            if (n.routes) { if (!list(n.routes)) fail('Routen'); for (const r of n.routes) if (!object(r) || !ip(r.network) || !isValidSubnetMask(r.subnetMask) || !ip(r.gateway) || !integer(r.interfaceIndex, 0, count - 1) || !integer(r.metric, 0, 65535)) fail('Route'); }
            if (n.portForwards) { if (!list(n.portForwards)) fail('Portweiterleitungen'); for (const p of n.portForwards) if (!object(p) || !['tcp','udp'].includes(p.protocol) || !integer(p.externalPort,1,65535) || !integer(p.internalPort,1,65535) || !ip(p.internalIP)) fail('Portweiterleitung'); }
            if (n.firewallRules) { if (!list(n.firewallRules)) fail('Firewall-Regeln'); for (const r of n.firewallRules) if (!object(r) || !['allow','deny'].includes(r.action) || !['inbound','outbound','both'].includes(r.direction) || !['any','icmp','tcp','udp'].includes(r.protocol) || typeof r.enabled !== 'boolean' || !text(r.id) || !isValidIPPattern(r.sourceIP) || !isValidIPPattern(r.destIP) || !isValidPortPattern(r.sourcePort) || !isValidPortPattern(r.destPort)) fail('Firewall-Regel'); }
        }
        if (n.iceServers && (!list(n.iceServers,32) || n.iceServers.some((server:any)=>!object(server)||!(typeof server.urls==='string'||Array.isArray(server.urls))||(Array.isArray(server.urls)?server.urls:[server.urls]).some((url:any)=>!text(url)||!/^(stun|stuns|turn|turns):/.test(url)))))fail('STUN/TURN-Konfiguration');
        if (n.installedApps && (!list(n.installedApps, 100) || n.installedApps.some((a: any) => !text(a, 64)))) fail('Anwendungen');
        ports.set(n.id, count); if (['rechner','notebook'].includes(n.type)) hosts.add(n.id);
    }
    const occupied = new Set<string>();
    for (const c of data.cables) {
        if (!object(c)) fail('Kabel'); if(c.wireless!==undefined&&typeof c.wireless!=='boolean')fail('WLAN-Verbindung'); if (c.id !== undefined) checkId(c.id);
        for (const endpoint of [c.endpoint1,c.endpoint2]) {
            if (!object(endpoint) || !ports.has(endpoint.nodeId) || !integer(endpoint.portIndex,0,ports.get(endpoint.nodeId)!-1)) fail('Kabelanschluss');
            const key = `${endpoint.nodeId}:${endpoint.portIndex}`; if (occupied.has(key)) fail('mehrfach belegter Anschluss'); occupied.add(key);
        }
        if (c.endpoint1.nodeId === c.endpoint2.nodeId) fail('Verbindung eines Geräts mit sich selbst');
    }
    if (data.docElements) { if (!list(data.docElements)) fail('Beschriftungen'); for (const d of data.docElements) if (!object(d) || !['textbox','label','rectangle'].includes(d.type) || !text(d.text) || !text(d.color,128) || !Number.isFinite(d.position?.x) || !Number.isFinite(d.position?.y) || !Number.isFinite(d.width) || d.width <= 0 || !Number.isFinite(d.height) || d.height <= 0) fail('Beschriftung'); }
    if (data.serviceState) {
        if (!object(data.serviceState)) fail('Dienste');
        for (const [key, states] of Object.entries(data.serviceState)) {
            if (!['dhcpServers','dnsServers','webServers','echoServers','emailServers','emailClients','fileSystems','peerToPeer','hostStates','editorSessions'].includes(key)) fail('Unbekannter Dienst: ' + key);
            if (!list(states, 2048)) fail('Dienstzustände'); const seen = new Set<string>();
            for (const state of states as any[]) {
                if (!object(state) || !(hosts.has(state.hostId)||key==='dhcpServers'&&data.nodes.some((n:any)=>n.id===state.hostId&&n.type==='router')) || seen.has(state.hostId)) fail('Dienst-Gerät'); seen.add(state.hostId);
                if (key === 'peerToPeer' && (!list(state.shares) || !list(state.peers) || state.shares.some((p: any) => !text(p)) || state.peers.some((p: any) => !object(p) || !ip(p.ip) || !integer(p.port,1,65535)))) fail('Dateiaustausch');
                if (key === 'echoServers' && !integer(state.port,1,65535)) fail('Server-Port');
                if(state.running !== undefined && typeof state.running !== 'boolean')fail('Dienststatus');
                if (key === 'dnsServers' && (!list(state.records) || state.records.some((r: any) => !object(r) || !text(r.name) || !r.name.trim() || !text(r.value) || ![1,2,5,12,15,16].includes(r.type) || !Number.isFinite(r.ttl) || r.ttl<0 || r.type===1&&!ip(r.value)))) fail('DNS-Einträge');
                if(key==='dhcpServers'&&state.interfaceIndex!==undefined&&!integer(state.interfaceIndex,0,ports.get(state.hostId)!-1))fail('DHCP-Schnittstelle');
                if (key === 'dhcpServers' && state.config) { const c=state.config; if (!object(c) || !ip(c.rangeStart) || !ip(c.rangeEnd) || !text(c.subnetMask) || !isValidSubnetMask(c.subnetMask) || (c.router && !ip(c.router)) || !list(c.dns,16) || c.dns.some((address:any)=>!ip(address)) || !Number.isFinite(c.leaseTime) || c.leaseTime < 1 || !sameNetwork(c.rangeStart,c.rangeEnd,c.subnetMask) || ipToNumber(c.rangeEnd)<ipToNumber(c.rangeStart) || ipToNumber(c.rangeEnd)-ipToNumber(c.rangeStart)>65535) fail('DHCP-Konfiguration'); }
                if (key === 'dhcpServers' && state.reservations) { if(!list(state.reservations))fail('Reservierungen');const addresses=new Set<string>(),macs=new Set<string>();for(const r of state.reservations){if(!object(r)||!isValidMAC(r.mac)||!ip(r.ip)||addresses.has(r.ip)||macs.has(r.mac.toUpperCase())||state.config&&!sameNetwork(r.ip,state.config.rangeStart,state.config.subnetMask))fail('DHCP-Reservierung');addresses.add(r.ip);macs.add(r.mac.toUpperCase());} }
                if (key === 'webServers' && (!list(state.files) || state.port!==undefined&&!integer(state.port,1,65535) || state.files.some((f:any)=>!object(f)||!text(f.name)||!text(f.content,25*1024*1024)||!text(f.mimeType)||f.lastModified!==undefined&&!(f.lastModified instanceof Date ? Number.isFinite(f.lastModified.getTime()) : date(f.lastModified))||f.name.replace(/^\/+/, '').split('/').some((part:string)=>!part||['.','..'].includes(part)||part.includes('\0')))))fail('Webdateien');
                const email=(e:any)=>{if(!object(e)||!text(e.subject??'',100000)||!text(e.body??'',25*1024*1024))fail('E-Mail');for(const field of ['to','cc','bcc'])if(e[field]&&(!list(e[field])||e[field].some((a:any)=>!object(a)||!text(a.mailAddress??'')||!text(a.displayName??''))))fail('Mailadresse');};
                const account=(a:any)=>{if(!object(a)||!text(a.username??'')||!text(a.password??'')||(a.messages&&!list(a.messages)))fail('Mailkonto');a.messages?.forEach(email);};
                if(key==='emailServers'){const s=state.serverState;if(!object(s)||!text(s.mailDomain)||!list(s.accounts))fail('Mailserver');s.accounts.forEach((entry:any)=>{if(!object(entry)||!text(entry.key))fail('Mailkonto');account(entry.account);});}
                if(key==='emailClients'){const s=state.clientState;if(!object(s))fail('Mailprogramm');if(s.account)account(s.account);for(const field of ['inbox','sent','drafts'])if(s[field]){if(!list(s[field]))fail('Postfach');s[field].forEach(email);}}

                if (key === 'editorSessions') {
                    if (!list(state.tabs,100) || !integer(state.activeTabIndex,0,state.tabs.length-1) || state.tabs.some((tab:any)=>!object(tab)||!(tab.path===null||text(tab.path))||!text(tab.name)||!text(tab.content,25*1024*1024)||typeof tab.isDirty!=='boolean')) fail('Editorentwürfe');
                }
                if (key === 'hostStates' && (!list(state.installedApps,100) || state.installedApps.some((a: any) => !text(a,64)))) fail('Anwendungen');
                if (key === 'fileSystems') {
                    let total = 0;
                    const walk = (node: any, depth: number) => {
                        if (!object(node) || depth > 64 || ++total > 100000 || !text(node.name,4096) || typeof node.isDirectory !== 'boolean' || (node.content !== undefined && !text(node.content,25*1024*1024))) fail('Dateisystem');
                        if (node.encoding !== undefined && (node.encoding !== 'data-url' || node.isDirectory || typeof node.content !== 'string' || !/^data:[\w.+-]+\/[\w.+-]+;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(node.content))) fail('Binärdatei');
                        if (node.lastModified !== undefined && !date(node.lastModified)) fail('Dateidatum');
                        if (node.mimeType !== undefined && !text(node.mimeType,256)) fail('Dateityp');
                        if (node.children !== undefined) {
                            if (!object(node.children) || !node.isDirectory) fail('Ordner');
                            for (const [name,child] of Object.entries(node.children)) {
                                if (!name || ['.','..'].includes(name) || name.includes('/') || name.includes('\0') || (child as any)?.name !== name) fail('Dateiname');
                                walk(child,depth+1);
                            }
                        }
                    };
                    walk(state.fsState,0);
                    if (!state.fsState.isDirectory) fail('Dateisystemwurzel');
                }
            }
        }
    }
}
