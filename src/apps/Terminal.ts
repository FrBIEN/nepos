import { legacyRuntime } from '../runtime/LegacyRuntime';
// Terminal - Command-line interface application with history and autocomplete

import type { PacketLogEntry } from '../network/PacketJournal';
import { getNetworkAddress, normalizeIP } from '../network/utils';
import { i18n } from '../i18n';
import { Host } from '../hardware/Host';

import { FileSystem } from './FileSystem';

export interface TerminalCommand {
    name: string;
    description: string;
    usage: string;
    execute: (args: string[], terminal: Terminal) => Promise<string>;
}

export interface PingResult {
    success: boolean;
    ip: string;
    time?: number;
    ttl?: number;
    error?: string;
}

export class Terminal {
    private get runtime() { return this.host?.runtime ?? legacyRuntime; }

    private host: Host;
    private interrupted=false;
    private stopDelay: (() => void) | null = null;
    private stopCapture: (()=>void)|null=null;
    interrupt(): void {this.interrupted=true;this.stopDelay?.();this.stopCapture?.();this.runtime.network.cancelProbes(this.host);}

    private outputBuffer: string[] = [];
    private commands: Map<string, TerminalCommand> = new Map();
    private onOutputCallback: ((line: string) => void) | null = null;
    private onClearCallback: (() => void) | null = null;

    // History
    private history: string[] = [];
    private historyIndex: number = -1;
    private currentInput: string = '';

    // File System State
    private currentDirectory: string = '/home';

    constructor(host: Host) {
        this.host = host;
        this.registerDefaultCommands();
    }

    onOutput(callback: (line: string) => void): void {
        this.onOutputCallback = callback;
    }

    onClear(callback: () => void): void {
        this.onClearCallback = callback;
    }

    private print(text: string): void {
        this.outputBuffer.push(text);
        if (this.onOutputCallback) {
            this.onOutputCallback(text);
        }
    }

    getOutput(): string[] {
        return [...this.outputBuffer];
    }

    clearOutput(): void {
        this.outputBuffer = [];
        if (this.onClearCallback) {
            this.onClearCallback();
        }
    }

    // History management
    addToHistory(command: string): void {
        if (command.trim() && (this.history.length === 0 || this.history[this.history.length - 1] !== command)) {
            this.history.push(command);
        }
        this.historyIndex = this.history.length;
        this.currentInput = '';
    }

    getPreviousCommand(currentInput: string): string | null {
        if (this.historyIndex === this.history.length) {
            this.currentInput = currentInput;
        }
        if (this.historyIndex > 0) {
            this.historyIndex--;
            return this.history[this.historyIndex];
        }
        return null;
    }

    getNextCommand(): string | null {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            return this.history[this.historyIndex];
        } else if (this.historyIndex === this.history.length - 1) {
            this.historyIndex = this.history.length;
            return this.currentInput;
        }
        return null;
    }

    // Autocomplete
    getCompletions(input: string): string[] {
        const parts = input.trim().split(/\s+/);
        if (parts.length === 0) return [];

        if (parts.length === 1 && !/\s$/.test(input)) {
            // Complete command names
            const partial = parts[0].toLowerCase();
            return Array.from(this.commands.keys())
                .filter(cmd => cmd.startsWith(partial))
                .map(cmd => cmd);
        }

        const command=parts[0], fragment=/\s$/.test(input) ? '' : parts.at(-1)!;
        if (!['cd','cat','ls','mkdir','touch','rm','cp','mv'].includes(command)) return [];
        const slash=fragment.lastIndexOf('/'), directory=slash<0 ? '.' : fragment.slice(0,slash+1), prefix=slash<0 ? '' : fragment.slice(0,slash+1), partial=fragment.slice(slash+1);
        const fs=this.getFileSystem(), cwd=fs.resolveNode(this.currentDirectory)!;
        const before=input.slice(0,input.length-fragment.length);
        return (fs.readdir(directory,cwd) || []).filter(name=>name.startsWith(partial)).filter(name=>command!=='cd'||fs.resolveNode(prefix+name,cwd)?.isDirectory).map(name=>before+prefix+name+(fs.resolveNode(prefix+name,cwd)?.isDirectory?'/':''));
    }

    async executeCommand(input: string): Promise<string> {
        this.interrupted=false;
        const parts = (input.match(/"(?:[^"\\]|\\.)*"|'[^']*'|[^\s]+/g)||[]).map(part=>part.startsWith('"')||part.startsWith("'")?part.slice(1,-1).replace(/\\(["\\])/g,'$1'):part);
        if (parts.length === 0 || parts[0] === '') {
            return '';
        }

        this.addToHistory(input);

        const commandName = parts[0].toLowerCase();
        const args = parts.slice(1);

        const command = this.commands.get(commandName);
        if (!command) {
            return `Unbekannter Befehl: ${commandName}. Tippe 'help' für verfügbare Befehle.\n`;
        }

        const release = this.runtime.operations.track(() => this.interrupt());
        try {
            return await command.execute(args, this);
        } catch (error) {
            return `Fehler beim Ausführen des Befehls: ${error}\n`;
        } finally { release(); }
    }

    registerCommand(command: TerminalCommand): void {
        this.commands.set(command.name.toLowerCase(), command);
    }

    getHost(): Host {
        return this.host;
    }

    getARPTable(): { ip: string; mac: string }[] { return this.runtime.network.getARPTable(this.host); }

    getCommandNames(): string[] {
        return Array.from(this.commands.keys());
    }

    getCurrentDirectory(): string {
        return this.currentDirectory;
    }

    private getFileSystem(): FileSystem {
        return this.runtime.hostFileSystemManager.getOrCreateFileSystem(this.host);
    }

    private registerDefaultCommands(): void {
        // help
        this.registerCommand({
            name: 'help',
            description: i18n.t('terminal.commands.help'),
            usage: 'help [command]',
            execute: async (args) => {
                if (args.length > 0) {
                    const cmd = this.commands.get(args[0].toLowerCase());
                    if (cmd) {
                        return `${cmd.name}: ${cmd.description}\nVerwendung: ${cmd.usage}\n`;
                    }
                    return `Unbekannter Befehl: ${args[0]}\n`;
                }

                let output = 'Verfügbare Befehle:\n';
                this.commands.forEach((cmd) => {
                    output += `  ${cmd.name.padEnd(12)} - ${cmd.description}\n`;
                });
                return output;
            },
        });

        // ---------------- FILE SYSTEM COMMANDS ----------------

        // ls
        this.registerCommand({
            name: 'ls',
            description: 'Verzeichnisinhalt anzeigen',
            usage: 'ls [pfad]',
            execute: async (args) => {
                const fs = this.getFileSystem();
                const cwdNode = fs.resolveNode(this.currentDirectory);
                if (!cwdNode) {
                    // Should not happen if currentDirectory is maintained correctly
                    this.currentDirectory = '/';
                    return 'Fehler: Arbeitsverzeichnis nicht gefunden. Zurückgesetzt auf /.\n';
                }

                const targetPath = args.length > 0 ? args[0] : '.';
                const node = fs.resolveNode(targetPath, cwdNode);

                if (!node) {
                    return `ls: Zugriff auf '${targetPath}' nicht möglich: Datei oder Verzeichnis nicht gefunden\n`;
                }

                if (!node.isDirectory) {
                    return `${node.name}\n`;
                }

                const children = fs.readdir(targetPath, cwdNode);
                if (!children || children.length === 0) {
                    return '';
                }

                return children.join('  ') + '\n';
            }
        });

        // cd
        this.registerCommand({
            name: 'cd',
            description: 'Arbeitsverzeichnis wechseln',
            usage: 'cd <pfad>',
            execute: async (args) => {
                if (args.length === 0) {
                    // cd -> home
                    const fs = this.getFileSystem();
                    if (fs.exists('/home')) {
                        this.currentDirectory = '/home';
                    } else {
                        this.currentDirectory = '/';
                    }
                    return '';
                }

                const targetPath = args[0];
                const fs = this.getFileSystem();
                const cwdNode = fs.resolveNode(this.currentDirectory);
                const node = fs.resolveNode(targetPath, cwdNode!);

                if (!node) {
                    return `cd: ${targetPath}: Datei oder Verzeichnis nicht gefunden\n`;
                }

                if (!node.isDirectory) {
                    return `cd: ${targetPath}: Ist kein Verzeichnis\n`;
                }

                // Update CWD absolute path
                this.currentDirectory = fs.getAbsolutePath(node);
                return '';
            }
        });

        // pwd
        this.registerCommand({
            name: 'pwd',
            description: 'Aktuelles Verzeichnis anzeigen',
            usage: 'pwd',
            execute: async () => {
                return `${this.currentDirectory}\n`;
            }
        });

        // cat
        this.registerCommand({
            name: 'cat',
            description: 'Dateiinhalt ausgeben',
            usage: 'cat <datei>',
            execute: async (args) => {
                if (args.length === 0) return 'Verwendung: cat <datei>\n';

                const fs = this.getFileSystem();
                const cwdNode = fs.resolveNode(this.currentDirectory)!;
                const path = args[0];

                const node = fs.resolveNode(path, cwdNode);

                if (!node) {
                    return `cat: ${path}: Datei oder Verzeichnis nicht gefunden\n`;
                }

                if (node.isDirectory) {
                    return `cat: ${path}: Ist ein Verzeichnis\n`;
                }

                const content = node.content || '';
                return content;
            }
        });

        // mkdir
        this.registerCommand({
            name: 'mkdir',
            description: 'Verzeichnis erstellen',
            usage: 'mkdir <name>',
            execute: async (args) => {
                if (args.length === 0) return 'Verwendung: mkdir <name>\n';

                const fs = this.getFileSystem();
                const cwdNode = fs.resolveNode(this.currentDirectory)!;
                const success = fs.mkdir(args[0], cwdNode);

                if (!success) {
                    return `mkdir: Konnte Verzeichnis '${args[0]}' nicht erstellen (existiert evtl. bereits).\n`;
                }
                return '';
            }
        });

        // touch (create empty file)
        this.registerCommand({
            name: 'touch',
            description: 'Leere Datei erstellen',
            usage: 'touch <datei>',
            execute: async (args) => {
                if (args.length === 0) return 'Verwendung: touch <datei>\n';

                const fs = this.getFileSystem();
                const cwdNode = fs.resolveNode(this.currentDirectory)!;
                const success = fs.touch(args[0], cwdNode);
                if (!success) {
                    return `touch: Konnte Datei '${args[0]}' nicht erstellen.\n`;
                }
                return '';
            }
        });

        // rm
        this.registerCommand({
            name: 'rm',
            description: 'Datei oder Verzeichnis löschen',
            usage: 'rm [-r] <datei>',
            execute: async (args) => {
                if (args.length === 0) return 'Verwendung: rm [-r] <datei>\n';

                let recursive = false;
                let target = args[0];

                if (args[0] === '-r') {
                    if (args.length < 2) return 'Verwendung: rm [-r] <datei>\n';
                    recursive = true;
                    target = args[1];
                }

                const fs = this.getFileSystem();
                const cwdNode = fs.resolveNode(this.currentDirectory)!;

                // Prevent deleting . or .. or root (handled in FS partially, but be safe)
                if (target === '.' || target === '..' || target === '/') return `rm: Kann '${target}' nicht löschen\n`;

                const success = fs.delete(target, recursive, cwdNode);
                if (!success) {
                    return `rm: Konnte '${target}' nicht löschen (vielleicht nicht leer? nutze -r)\n`;
                }
                return '';
            }
        });

        for(const name of ['cp','mv'])this.registerCommand({name,description:name==='cp'?'Datei/Ordner kopieren':'Datei/Ordner verschieben',usage:`${name} <quelle> <ziel>`,execute:async args=>{
            if(args.length!==2)return `Verwendung: ${name} <quelle> <ziel>\n`;
            const fs=this.getFileSystem();return fs.transfer(args[0],args[1],name==='mv',fs.resolveNode(this.currentDirectory)!)?'':`${name}: Quelle oder Ziel ungültig\n`;
        }});
        this.registerCommand({name:'netstat',description:'Aktive TCP/UDP-Sockets anzeigen',usage:'netstat',execute:async()=>['Protokoll  Lokal                    Gegenstelle              Zustand',...this.runtime.network.getSocketStates(this.host).map(s=>`${s.type.padEnd(10)}${s.local.padEnd(25)}${s.remote.padEnd(25)}${s.state}`)].join('\n')+'\n'});
        this.registerCommand({name:'arpsend',description:'ARP-Antwort mit vorgegebener Sender-IP senden',usage:'arpsend <sender-ip> <ziel-ip>',execute:async args=>{
            if(args.length!==2||!args.every(ip=>normalizeIP(ip)))return 'Verwendung: arpsend <sender-ip> <ziel-ip>\n';
            this.runtime.network.sendARPReply(this.host,args[0],args[1]);return `ARP-Antwort gesendet: ${args[0]} ist ${this.host.getMAC()}\n`;
        }});
        this.registerCommand({name:'tcpdump',description:'Live-Paketmitschnitt (Abbrechen oder Ctrl+C beendet)',usage:'tcpdump [-c anzahl]',execute:async args=>{
            const limit=args[0]==='-c'?Number(args[1]):Infinity;if(!(limit>0))return 'Verwendung: tcpdump [-c anzahl]\n';
            this.print('Paketmitschnitt läuft – Abbrechen beendet.');let count=0;
            return new Promise<string>(resolve=>{const subscription=this.runtime.events.on('packet:logged',(entry:PacketLogEntry)=>{if(entry.relatedDeviceId!==this.host.getId())return;
                this.print(`${entry.timestamp}ms ${entry.application && entry.application!=='-' ? entry.application : entry.transport} ${entry.sourceIP}:${entry.sourcePort} > ${entry.destIP}:${entry.destPort} ${entry.info}`);if(++count>=limit)this.stopCapture?.();});
                this.stopCapture=()=>{subscription.unsubscribe();this.stopCapture=null;resolve('Mitschnitt beendet.\n');};});
        }});
        // ---------------- NETWORK COMMANDS (Existing) ----------------

        // ipconfig
        this.registerCommand({
            name: 'ipconfig',
            description: i18n.t('terminal.commands.ipconfig'),
            usage: 'ipconfig',
            execute: async () => {
                const iface = this.host.getNetworkInterface();
                return [
                    `Netzwerkkonfiguration:`,
                    `  Hostname:     ${this.host.getName()}`,
                    `  IP-Adresse:   ${iface.getIP()}`,
                    `  Subnetzmaske: ${iface.getSubnetMask()}`,
                    `  Gateway:      ${iface.getGateway() || '(nicht gesetzt)'}`,
                    `  DNS-Server:   ${iface.getDNS() || '(nicht gesetzt)'}`,
                    `  MAC-Adresse:  ${iface.getMAC()}`,
                    `  DHCP:         ${iface.isDHCPEnabled() ? 'Aktiviert' : 'Deaktiviert'}`,
                    '',
                ].join('\n');
            },
        });

        // dhcp - request IP from DHCP server
        this.registerCommand({
            name: 'dhcp',
            description: 'IP-Adresse vom DHCP-Server beziehen',
            usage: 'dhcp',
            execute: async () => {
                const iface = this.host.getNetworkInterface();

                if (!iface.isDHCPEnabled()) {
                    return 'DHCP ist nicht aktiviert. Aktiviere DHCP in der Gerätekonfiguration.\n';
                }

                this.print('DHCP-Anfrage wird gesendet...\n');

                try {
                    const { DHCPClient } = await import('./DHCP');
                    if (this.interrupted) return 'DHCP-Anfrage abgebrochen.\n';
                    const client = new DHCPClient(iface.getMAC(), this.host.getName(), this.host);
                    const config = await client.requestIP();

                    if (this.interrupted) { client.cancel(); return 'DHCP-Anfrage abgebrochen.\n'; }
                    iface.setIP(config.ip);
                    iface.setSubnetMask(config.subnetMask);
                    iface.setGateway(config.router);
                    if (config.dns.length > 0) {
                        iface.setDNS(config.dns[0]);
                    }

                    return [
                        `DHCP-Konfiguration erhalten:`,
                        `  IP-Adresse:   ${config.ip}`,
                        `  Subnetzmaske: ${config.subnetMask}`,
                        `  Gateway:      ${config.router}`,
                        `  DNS-Server:   ${config.dns.join(', ') || '(keine)'}`,
                        '',
                    ].join('\n');
                } catch (err) {
                    return `DHCP-Fehler: ${(err as Error).message}\n`;
                }
            },
        });

        // ping
        this.registerCommand({
            name: 'ping',
            description: i18n.t('terminal.commands.ping'),
            usage: 'ping <ip-adresse> [-c anzahl]',
            execute: async (args) => {
                if (args.length === 0) {
                    return 'Verwendung: ping <ip-adresse> [-c anzahl]\n';
                }

                const target = args[0];
                let count = 4;

                const countIndex = args.indexOf('-c');
                if (countIndex !== -1 && args[countIndex + 1]) {
                    count = Number(args[countIndex + 1]);
                    if (!Number.isInteger(count) || count < 1 || count > 100) return 'Anzahl muss zwischen 1 und 100 liegen.\n';
                }

                // Validate IP or Hostname
                const resolveResult = await this.resolveHost(target);
                if (!resolveResult.success) {
                    return `Ping-Anforderung konnte Host "${target}" nicht finden. Überprüfen Sie den Namen, und versuchen Sie es erneut.\n`;
                }
                const targetIP = resolveResult.ip!;

                // Print header
                this.print(`Ping wird ausgeführt für ${targetIP} mit 32 Bytes Daten:\n`);

                let successCount = 0;
                let totalTime = 0;
                const times: number[] = [];

                // Execute pings with 1-second delay between each
                for (let i = 0; i < count && !this.interrupted; i++) {
                    // Wait 1 second between pings (but not before the first one)
                    if (i > 0) {
                        await new Promise<void>(resolve => {
                            const finish = () => { this.runtime.simulation.clearTimeout(timer); release(); this.stopDelay = null; resolve(); };
                            const timer = this.runtime.simulation.setTimeout(finish, 1000);
                            const release = this.runtime.operations.track(() => { this.interrupted = true; finish(); });
                            this.stopDelay = finish;
                        });
                        if (this.interrupted) break;
                    }

                    const result = await this.executePing(targetIP, i + 1);
                    if (result.success) {
                        successCount++;
                        totalTime += result.time!; times.push(result.time!);
                        this.print(`Antwort von ${result.ip}: Zeit=${result.time}ms TTL=${result.ttl}`);
                    } else {
                        // More realistic error messages
                        this.print(result.error || 'Zeitüberschreitung der Anforderung.');
                    }
                }

                // Statistics
                const lossPercent = Math.round((1 - successCount / count) * 100);
                this.print('');
                this.print(`Ping-Statistik für ${targetIP}:`);
                this.print(`    Pakete: Gesendet = ${count}, Empfangen = ${successCount}, Verloren = ${count - successCount} (${lossPercent}% Verlust)`);
                if (successCount > 0) {
                    const avgTime = Math.round(totalTime / successCount);
                    this.print(`Zeitangaben in Millisekunden:`);
                    this.print(`    Minimum = ${Math.min(...times)}ms, Maximum = ${Math.max(...times)}ms, Mittelwert = ${avgTime}ms`);
                }
                this.print('');

                return ''; // Already printed via streaming
            },
        });

        // traceroute
        this.registerCommand({
            name: 'traceroute',
            description: i18n.t('terminal.commands.traceroute'),
            usage: 'traceroute <ip-adresse>',
            execute: async (args) => {
                if (args.length === 0) {
                    return 'Verwendung: traceroute <ip-adresse>\n';
                }

                const target = args[0];
                const resolveResult = await this.resolveHost(target);

                if (!resolveResult.success) {
                    return `Der Zielname ${target} konnte nicht aufgelöst werden.\n`;
                }

                const targetIP = resolveResult.ip!;

                const results: string[] = [`Routenverfolgung zu ${target} [${targetIP}]:\n`];

                for (let ttl = 1; ttl <= 30 && !this.interrupted; ttl++) {
                    const result = await this.runtime.network.probe(this.host, targetIP, ttl);
                    results.push(`  ${ttl}    ${result.time ?? '*'} ms    ${result.ip || '*'} ${result.error || ''}`);
                    if (result.success || (!result.exceeded && result.error)) break;
                }

                results.push('');
                results.push('Ablaufverfolgung beendet.');
                results.push('');

                return results.join('\n');
            },
        });

        // arp
        this.registerCommand({
            name: 'arp',
            description: i18n.t('terminal.commands.arp'),
            usage: 'arp [-a] [-d ip]',
            execute: async (args) => {
                if (args.includes('-d') && args.length > args.indexOf('-d') + 1) {
                    const ip = args[args.indexOf('-d') + 1];
                    this.runtime.network.removeARPEntry(this.host, ip);
                    return `Eintrag für ${ip} gelöscht.\n`;
                }

                const entries = this.runtime.network.getARPTable(this.host);
                if (entries.length === 0) {
                    return 'ARP-Cache ist leer.\n';
                }

                let output = 'ARP-Cache:\n';
                output += '  IP-Adresse        MAC-Adresse         Typ\n';
                output += '  ---------------   -----------------   ------\n';

                entries.forEach(entry => {
                    output += `  ${entry.ip.padEnd(16)}  ${entry.mac.padEnd(18)}  dynamisch\n`;
                });

                return output;
            },
        });

        // route
        this.registerCommand({
            name: 'route',
            description: i18n.t('terminal.commands.route'),
            usage: 'route',
            execute: async () => {
                const iface = this.host.getNetworkInterface();
                const gateway = iface.getGateway();

                let output = 'Routing-Tabelle:\n';
                output += '  Netzwerk          Maske               Gateway         Schnittstelle\n';
                output += '  ---------------   ---------------     --------------- ---------------\n';
                output += `  ${getNetworkAddress(iface.getIP(),iface.getSubnetMask()).padEnd(18)}${iface.getSubnetMask().padEnd(20)}0.0.0.0         ${iface.getIP()}\n`;
                if(gateway)output += `  0.0.0.0           0.0.0.0             ${gateway.padEnd(15)} ${iface.getIP()}\n`;

                return output;
            },
        });

        // clear
        this.registerCommand({
            name: 'clear',
            description: 'Bildschirm löschen',
            usage: 'clear',
            execute: async () => {
                this.clearOutput();
                return '';
            },
        });

        // hostname
        this.registerCommand({
            name: 'hostname',
            description: 'Hostnamen anzeigen oder setzen',
            usage: 'hostname [neuer-name]',
            execute: async (args) => {
                if (args.length > 0) {
                    this.host.setName(args[0]);
                    return `Hostname gesetzt auf: ${args[0]}\n`;
                }
                return `${this.host.getName()}\n`;
            },
        });

        // nslookup
        this.registerCommand({
            name: 'nslookup',
            description: 'DNS-Abfrage durchführen',
            usage: 'nslookup <domain>',
            execute: async (args) => {
                if (args.length === 0) {
                    return 'Verwendung: nslookup <domain>\n';
                }

                const domain = args[0];
                const dnsServerIP = this.host.getNetworkInterface().getDNS();

                if (!dnsServerIP) {
                    return 'Kein DNS-Server konfiguriert.\n';
                }

                this.print(`Server:  ${dnsServerIP}\nAddress: ${dnsServerIP}\n\n`);

                try {
                    const { DNSClient, DNSRecordType } = await import('./DNS');
                    const client = new DNSClient(dnsServerIP, this.host);

                    this.print(`Non-authoritative answer:\n`);
                    this.print(`Name:    ${domain}\n`);

                    try {
                        const records = await client.resolve(domain, DNSRecordType.A);
                        records.forEach(r => {
                            this.print(`Address: ${r.value}\n`);
                        });

                        if (records.length === 0) {
                            this.print(`*** ${dnsServerIP} kann "${domain}" nicht finden: Non-existent domain\n`);
                        }

                    } catch (e) {
                        this.print(`*** ${dnsServerIP} kann "${domain}" nicht finden: ${(e as Error).message}\n`);
                    }

                    client.close();
                    return '';
                } catch (e) {
                    return `Fehler bei der DNS-Abfrage: ${(e as Error).message}\n`;
                }
            },
        });

        // host
        this.registerCommand({
            name: 'host',
            description: 'DNS-Lookup durchführen',
            usage: 'host <domain>',
            execute: async (args) => {
                if (args.length === 0) {
                    return 'Verwendung: host <domain>\n';
                }

                const domain = args[0];
                const dnsServerIP = this.host.getNetworkInterface().getDNS();

                if (!dnsServerIP) {
                    return 'Host nicht gefunden: Kein DNS-Server konfiguriert.\n';
                }

                try {
                    const { DNSClient } = await import('./DNS');
                    const client = new DNSClient(dnsServerIP, this.host);
                    const records = await client.resolve(domain);
                    client.close();

                    if (records.length > 0) {
                        return `${domain} hat die Adresse ${records[0].value}\n`;
                    } else {
                        return `Host ${domain} nicht gefunden.\n`;
                    }
                } catch (e) {
                    return `Host ${domain} nicht gefunden: ${(e as Error).message}\n`;
                }
            }
        });
        for(const [alias,name] of Object.entries({copy:'cp',move:'mv',del:'rm',dir:'ls',type:'cat'})){const command=this.commands.get(name)!;this.registerCommand({...command,name:alias});}
    }

    private async resolveHost(hostOrIp: string): Promise<{success:boolean;ip?:string}> {
        const ip=await this.host.resolveHost(hostOrIp);return ip?{success:true,ip}:{success:false};
    }

    private async executePing(targetIP: string, _seq: number): Promise<PingResult> {
        return this.runtime.network.probe(this.host, targetIP);
    }
}
