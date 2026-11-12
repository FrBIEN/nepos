import type { RuntimeDependencies } from '../runtime/RuntimeDependencies';
import { assertRuntimeOwner } from '../runtime/assertRuntimeOwner';
import { legacyRuntime } from '../runtime/LegacyRuntime';

// WebServer - Full HTTP server with global registry for network communication

import { Host } from '../hardware/Host';
import { createTCPSocket, Socket } from '../transport/Socket';
import { FileSystem } from './FileSystem';

export interface WebFile {
    name: string; // Keep interface for compatibility for now, but name is path now
    content: string;
    mimeType: string;
    lastModified: Date;
}

export interface HTTPRequest {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    headers: Record<string, string>;
    body?: string;
}

export interface HTTPResponse {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
}

export interface AccessLogEntry {
    timestamp: Date;
    clientIP: string;
    method: string;
    path: string;
    status: number;
    size: number;
}

export class WebServer {
    private get runtime() { return this.host?.runtime ?? legacyRuntime; }

    private host: Host;
    private port: number = 80;
    // files map removal - using FileSystem instead
    private running: boolean = false;
    private accessLog: AccessLogEntry[] = [];
    private socket: Socket | null = null;
    private mimeTypes: Record<string, string> = {
        'html': 'text/html',
        'css': 'text/css',
        'js': 'text/javascript',
        'json': 'application/json',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'txt': 'text/plain',
    };

    constructor(host: Host, initialize = true) {
        this.host = host;
        if (initialize) this.initDefaultFiles();
    }

    private getFileSystem(): FileSystem {
        return this.runtime.hostFileSystemManager.getOrCreateFileSystem(this.host);
    }

    private initDefaultFiles(): void {
        const fs = this.getFileSystem();

        // Ensure web root exists
        if (!fs.exists('/web')) {
            fs.mkdir('/web');
        }

        const hostName = this.host.getName();
        const hostIP = this.host.getIP();

        // Default files - only create if they don't exist to avoid overwriting user changes
        if (!fs.exists('/web/index.html')) {
            fs.writeFile('/web/index.html', `<!DOCTYPE html>
<html>
<head>
  <title>Willkommen auf ${hostName}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
    h1 { color: #333; }
    .info { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    a { color: #0066cc; }
  </style>
</head>
<body>
  <h1>Willkommen auf dem Webserver!</h1>
  <div class="info">
    <p>Dies ist die Standardseite des Webservers auf <strong>${hostName}</strong>.</p>
    <p>Server-IP: <strong>${hostIP}</strong></p>
    <p>Bearbeite diese Datei im Datei-Explorer unter <code>/web/index.html</code>.</p>
  </div>
  <h2>Weitere Seiten</h2>
  <ul>
    <li><a href="/about.html">Über uns</a></li>
    <li><a href="/contact.html">Kontakt</a></li>
  </ul>
</body>
</html>`);
        }

        if (!fs.exists('/web/about.html')) {
            fs.writeFile('/web/about.html', `<!DOCTYPE html>
<html>
<head>
  <title>Über uns</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
    h1 { color: #333; }
    .content { background: #fff; padding: 20px; border-radius: 8px; }
    a { color: #0066cc; }
  </style>
</head>
<body>
  <h1>Über uns</h1>
  <div class="content">
    <p>Dies ist die Über-uns-Seite.</p>
    <p><a href="/index.html">Zurück zur Startseite</a></p>
  </div>
</body>
</html>`);
        }

        if (!fs.exists('/web/contact.html')) {
            fs.writeFile('/web/contact.html', `<!DOCTYPE html>
<html>
<head>
  <title>Kontakt</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
    h1 { color: #333; }
    .content { background: #fff; padding: 20px; border-radius: 8px; }
    a { color: #0066cc; }
  </style>
</head>
<body>
  <h1>Kontakt</h1>
  <div class="content">
    <p>Kontaktieren Sie uns unter: admin@example.local</p>
    <p><a href="/index.html">Zurück zur Startseite</a></p>
  </div>
</body>
</html>`);
        }

        if (!fs.exists('/web/404.html')) {
            fs.writeFile('/web/404.html', `<!DOCTYPE html>
<html>
<head>
  <title>404 - Seite nicht gefunden</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; text-align: center; }
    h1 { color: #e74c3c; font-size: 72px; margin-bottom: 0; }
    p { color: #666; }
    a { color: #0066cc; }
  </style>
</head>
<body>
  <h1>404</h1>
  <p>Die angeforderte Seite wurde nicht gefunden.</p>
  <p><a href="/index.html">Zurück zur Startseite</a></p>
</body>
</html>`);
        }

        if (!fs.exists('/web/style.css')) {
            fs.writeFile('/web/style.css', `/* Stylesheets für den Webserver */
body {
  font-family: Arial, sans-serif;
  margin: 0;
  padding: 20px;
  background-color: #f5f5f5;
}

h1, h2, h3 {
  color: #333;
}

a {
  color: #0066cc;
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}
`);
        }
    }

    start(): void {
        if (this.running) return;
        this.running = true;

        // Register with global registry

        // Bind to 0.0.0.0 (though NetworkStack binds by HostID)
        this.socket = createTCPSocket(this.host);
        try {
            if (!this.socket.bind(this.port, '0.0.0.0') || !this.socket.listen()) throw new Error('Port bereits belegt');

            // Handle incoming requests via Socket
            this.socket.onData((msg) => {
                const requestStr = typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data);

                // Parse HTTP Request
                // Minimal parser: "GET /path HTTP/1.1"
                const lines = requestStr.split('\r\n');
                const requestLine = lines[0];
                const parts = requestLine.split(' ');

                if (parts.length >= 2 && msg.source) {
                    const method = parts[0] as 'GET' | 'POST';
                    const path = parts[1];
                    const request: HTTPRequest = {
                        method: method,
                        path: path,
                        headers: Object.fromEntries(lines.slice(1).filter(line => line.includes(':')).map(line => [line.slice(0,line.indexOf(':')).trim(),line.slice(line.indexOf(':')+1).trim()])),
                        body: requestStr.split('\r\n\r\n').slice(1).join('\r\n\r\n')
                    };

                    const clientIP = msg.source.ip;
                    const response = this.handleRequest(request, clientIP);

                    // Format HTTP Response
                    const responseStr = `HTTP/1.1 ${response.status} ${response.statusText}\r\nContent-Type: ${response.headers['Content-Type'] || 'text/html'}\r\nContent-Length: ${new TextEncoder().encode(response.body).length}\r\n\r\n${response.body}`;

                    // Send back via Socket
                    if (this.socket) {
                        this.socket.send(responseStr, msg.source);

                        // Close connection after response (HTTP/1.0 style for simplicity, or keep alive)
                        // Filius usually closes. But let's keep it simple.
                        // Actually, client will close?
                    }
                }
            });
        } catch (e) {
            this.stop();
            console.warn('[WebServer] Failed to bind socket:', e);
        }

        console.log(`WebServer gestartet auf ${this.host.getIP()}:${this.port}`);
    }

    stop(): void {
        this.running = false;

        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }

        console.log('WebServer gestoppt');
    }

    getHost(): Host {
        return this.host;
    }

    getPort(): number {
        return this.port;
    }

    setPort(port: number): void {
        if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Ungültiger HTTP-Port');
        if(this.running)throw new Error('Webserver zuerst stoppen');
        this.port = port;
    }

    // Deprecated: used by old editor code, remove when editor refactored
    // Currently mapping to FS calls for compatibility during migration if any calls remain
    getFile(path: string): WebFile | null {
        const fs = this.getFileSystem();
        let fsPath = path.startsWith('/') ? `/web${path}` : `/web/${path}`;

        // Handle root
        if (path === '/' || path === '/index.html') fsPath = '/web/index.html';

        const content = fs.readFile(fsPath);
        if (content !== null) {
            const stats = fs.getStats(fsPath);
            // Infer mime type
            const ext = fsPath.split('.').pop() || 'txt';
            const mimeType = fs.isBinary(fsPath) ? fs.resolveNode(fsPath)?.mimeType || 'application/octet-stream' : this.mimeTypes[ext] || 'text/plain';

            return {
                name: path,
                content,
                mimeType,
                lastModified: stats?.lastModified || new Date()
            };
        }
        return null;
    }

    // Deprecated
    createFile(name: string, content: string = '', mimeType: string = 'text/html'): WebFile {
        const fs = this.getFileSystem();
        const path = name.startsWith('/') ? `/web${name}` : `/web/${name}`;
        fs.writeFile(path, content);
        return {
            name,
            content,
            mimeType,
            lastModified: new Date()
        };
    }

    // Deprecated
    updateFile(path: string, content: string): boolean {
        const fs = this.getFileSystem();
        const fsPath = path.startsWith('/') ? `/web${path}` : `/web/${path}`;
        return fs.writeFile(fsPath, content);
    }

    // Deprecated
    deleteFile(path: string): boolean {
        const fs = this.getFileSystem();
        const fsPath = path.startsWith('/') ? `/web${path}` : `/web/${path}`;
        if (fsPath === '/web/index.html' || fsPath === '/web/404.html') {
            return false;
        }
        return fs.delete(fsPath);
    }

    // New API for Explorer
    getFiles(): WebFile[] {
        const fs = this.getFileSystem();
        const files: WebFile[] = [];
        const fileNames = fs.readdir('/web');

        if (fileNames) {
            fileNames.forEach(name => {
                const path = `/web/${name}`;
                const content = fs.readFile(path);
                const stats = fs.getStats(path);
                if (content !== null && stats && !stats.isDirectory) {
                    const ext = name.split('.').pop() || 'txt';
                    files.push({
                        name: `/${name}`,
                        content,
                        mimeType: fs.isBinary(path) ? fs.resolveNode(path)?.mimeType || 'application/octet-stream' : this.mimeTypes[ext] || 'text/plain',
                        lastModified: stats.lastModified
                    });
                }
            });
        }
        return files;
    }

    // Deprecated setter
    setFiles(files: WebFile[]): void {
        const fs=this.getFileSystem(); if(!fs.exists('/web'))fs.mkdir('/web');
        for (const file of files) {
            const path = '/web/' + file.name.replace(/^\/+/, '');
            // The full filesystem is authoritative; do not rewrite identical files and lose their dates.
            if (fs.readFile(path) === file.content) continue;
            const parts=path.split('/').filter(Boolean);parts.pop();let directory='';
            for(const part of parts){directory+='/'+part;if(!fs.exists(directory)&&!fs.mkdir(directory))throw new Error('Webordner konnte nicht angelegt werden');}
            if (!fs.writeFile(path,file.content)) throw new Error('Webdatei konnte nicht wiederhergestellt werden');
            const node=fs.resolveNode(path)!;node.mimeType=file.mimeType;
            if(file.lastModified !== undefined){const date=new Date(file.lastModified);if(!Number.isFinite(date.getTime()))throw new Error('Ungültiges Webdateidatum');node.lastModified=date;}
        }
    }

    // HTTP request handling
    handleRequest(request: HTTPRequest, clientIP: string): HTTPResponse {
        if (!this.running) {
            return {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'text/plain' },
                body: 'Server ist nicht gestartet.',
            };
        }

        let response: HTTPResponse;

        switch (request.method) {
            case 'GET':
                response = this.handleGET(request);
                break;
            case 'POST':
            case 'PUT':
            case 'DELETE':
                response = {
                    status: 405,
                    statusText: 'Method Not Allowed',
                    headers: { 'Content-Type': 'text/plain' },
                    body: 'Methode nicht erlaubt.',
                };
                break;
            default:
                response = {
                    status: 400,
                    statusText: 'Bad Request',
                    headers: { 'Content-Type': 'text/plain' },
                    body: 'Ungültige Anfrage.',
                };
        }

        // Log access
        this.accessLog.push({
            timestamp: new Date(),
            clientIP,
            method: request.method,
            path: request.path,
            status: response.status,
            size: response.body.length,
        });

        // Keep log size manageable
        if (this.accessLog.length > 100) {
            this.accessLog = this.accessLog.slice(-100);
        }

        return response;
    }

    private handleGET(request: HTTPRequest): HTTPResponse {
        let path: string;
        try { path = decodeURIComponent(request.path.split('?')[0]); } catch { return { status: 400, statusText: 'Bad Request', headers: {}, body: 'Ungültiger Pfad' }; }
        if (!path.startsWith('/') || path.split('/').includes('..') || path.includes('\\')) return { status: 403, statusText: 'Forbidden', headers: {}, body: 'Zugriff verweigert' };

        // Default to index.html
        if (path === '/' || path === '') {
            path = '/index.html';
        }

        // Map web path to FS path
        const fsPath = `/web${path}`;
        const fs = this.getFileSystem();
        const content = fs.readFile(fsPath);
        const stats = fs.getStats(fsPath);

        if (content !== null && stats) {
            const ext = path.split('.').pop() || 'txt';
            const mimeType = fs.isBinary(fsPath) ? fs.resolveNode(fsPath)?.mimeType || 'application/octet-stream' : this.mimeTypes[ext] || 'text/plain';

            return {
                status: 200,
                statusText: 'OK',
                headers: {
                    'Content-Type': mimeType,
                    'Content-Length': String(new TextEncoder().encode(content).length),
                    'Last-Modified': stats.lastModified.toUTCString(),
                },
                body: content,
            };
        }

        // Return 404
        const notFoundContent = fs.readFile('/web/404.html');
        return {
            status: 404,
            statusText: 'Not Found',
            headers: { 'Content-Type': 'text/html' },
            body: notFoundContent || '<h1>404 - Not Found</h1>',
        };
    }

    getAccessLog(): AccessLogEntry[] {
        return [...this.accessLog];
    }

    clearAccessLog(): void {
        this.accessLog = [];
    }

    isRunning(): boolean {
        return this.running;
    }
}

// HTTP client. Every request, including page resources, goes through a simulated socket.
export class WebBrowser {
    private get runtime() { return this.host?.runtime ?? legacyRuntime; }

    private currentURL = '';
    private history: string[] = [];
    private historyIndex = -1;
    private pending = new Set<Socket>();
    private closed = false;
    constructor(private host: Host) {}
    async navigate(value: string, method: 'GET'|'POST'='GET', body=''): Promise<HTTPResponse> {
        if (this.currentURL !== value) { this.history = this.history.slice(0,this.historyIndex+1); this.history.push(value); this.historyIndex=this.history.length-1; }
        this.currentURL=value; return this.fetchResource(value,method,body);
    }
    async fetchResource(value: string, method: 'GET'|'POST'='GET', body=''): Promise<HTTPResponse> {
        let url: URL;
        try { url=new URL(value.includes('://') ? value : `http://${value}`); if(url.protocol!=='http:' || url.username || url.password) throw new Error('Nur simuliertes HTTP wird unterstützt'); }
        catch(error) { return this.error('Invalid URL',String(error)); }
        if(this.closed)return this.error('Closed','Browser geschlossen');
        const epoch = this.runtime.operations.epoch;
        const release = this.runtime.operations.track(() => this.close());
        try {
        const ip=await this.host.resolveHost(url.hostname);
        if (epoch !== this.runtime.operations.epoch) return this.error('Cancelled', 'Simulation beendet');
        if (!ip) return this.error('DNS Error',`Host ${url.hostname} konnte nicht aufgelöst werden.`);
        if (this.closed) return this.error('Closed','Browser geschlossen');
        return await this.performRequest(ip,url,method,body);
        } finally { release(); }
    }
    private error(statusText: string, body: string): HTTPResponse { return {status:0,statusText,headers:{'Content-Type':'text/plain'},body}; }
    private performRequest(ip: string, url: URL, method: 'GET'|'POST', body: string): Promise<HTTPResponse> {
        return new Promise(resolve => {
            const socket=createTCPSocket(this.host); this.pending.add(socket);
            let responseData='', done=false;
            const finish=(response: HTTPResponse) => { if(done)return;done=true;this.runtime.simulation.clearTimeout(timeout);this.pending.delete(socket);socket.close();resolve(response); };
            const parse=(): HTTPResponse | null => {
                const end=responseData.indexOf('\r\n\r\n');if(end<0)return null;
                const lines=responseData.slice(0,end).split('\r\n'),status=lines.shift()!.match(/^HTTP\/1\.[01] (\d{3}) (.*)$/);if(!status)return this.error('Invalid response','Ungültige HTTP-Antwort');
                const headers: Record<string,string>={};for(const line of lines){const index=line.indexOf(':');if(index>0)headers[line.slice(0,index).trim()]=line.slice(index+1).trim();}
                const body=responseData.slice(end+4), lengthHeader=Object.entries(headers).find(([key])=>key.toLowerCase()==='content-length')?.[1];
                if(lengthHeader!==undefined && new TextEncoder().encode(body).length<Number(lengthHeader))return null;
                return {status:Number(status[1]),statusText:status[2],headers,body};
            };
            const timeout=this.runtime.simulation.setTimeout(()=>finish(this.error('Timeout','HTTP-Zeitüberschreitung')),20000);
            socket.onConnect(()=>socket.send(`${method} ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n${method==='POST'?`Content-Type: application/x-www-form-urlencoded\r\nContent-Length: ${new TextEncoder().encode(body).length}\r\n`:""}\r\n${body}`));
            socket.onData(message=>{responseData+=typeof message.data==='string'?message.data:JSON.stringify(message.data);if(responseData.length>16*1024*1024)return finish(this.error('Response too large','HTTP-Antwort zu groß'));const result=parse();if(result)finish(result);});
            socket.onClose(()=>{if(!done)finish(parse()||this.error('Connection closed','Verbindung ohne vollständige Antwort geschlossen.'));});
            socket.onError(error=>finish(this.error('Connection error',error.message)));
            if(!socket.connect(ip,Number(url.port)||80))finish(this.error('Connection error','Verbindungsaufbau fehlgeschlagen'));
        });
    }
    close(): void { this.closed=true;[...this.pending].forEach(socket=>socket.close());this.pending.clear(); }
    canGoBack(): boolean { return this.historyIndex>0; }
    canGoForward(): boolean { return this.historyIndex<this.history.length-1; }
    goBack(): string|null { if(!this.canGoBack())return null;return this.currentURL=this.history[--this.historyIndex]; }
    goForward(): string|null { if(!this.canGoForward())return null;return this.currentURL=this.history[++this.historyIndex]; }
    getCurrentURL(): string { return this.currentURL; }
    getHistory(): string[] { return [...this.history]; }
}

// Host-level server manager (keeps servers running even when desktop closed)
export class HostServerManager {
    constructor(private owner?: RuntimeDependencies) {}

    private servers: Map<string, WebServer> = new Map(); // hostId -> WebServer
    private previouslyRunning: Set<string> = new Set();

    getOrCreateServer(host: Host): WebServer {
        assertRuntimeOwner(host, this.owner);
        const hostId = host.getId();
        let server = this.servers.get(hostId);
        if (!server) {
            server = new WebServer(host);
            this.servers.set(hostId, server);
        }
        return server;
    }

    getServer(hostId: string): WebServer | null {
        return this.servers.get(hostId) || null;
    }

    removeServer(hostId: string): void {
        const server = this.servers.get(hostId);
        if (server?.isRunning()) {
            server.stop();
        }
        this.servers.delete(hostId);
        this.previouslyRunning.delete(hostId);
    }

    /**
     * Start servers that were running previously (Simulation Mode start)
     */
    restartServers(): void {
        console.log(`[HostServerManager] Restarting ${this.servers.size} web servers`);
        this.servers.forEach((server, hostId) => {
            if (server.isRunning()) {
                console.log(`[HostServerManager] Force restarting server on ${hostId} for simulation context`);
                server.stop();
                server.start();
            } else if (this.previouslyRunning.has(hostId)) {
                server.start();
            }
        });

        this.previouslyRunning.clear();
    }

    /**
     * Stop all servers but remember who was running (Design Mode start / Simulation stop)
     */
    stopAll(): void {
        this.servers.forEach((server, hostId) => {
            if (server.isRunning()) {
                this.previouslyRunning.add(hostId);
                server.stop();
            }
        });
    }

    /**
     * Get persistence state for all web servers
     */
    getServiceState(): { hostId: string; files: WebFile[]; port?: number; running: boolean }[] {
        const state: { hostId: string; files: WebFile[]; port?: number; running: boolean }[] = [];
        this.servers.forEach((server, hostId) => {
            state.push({
                hostId,
                files: server.getFiles(),
                port: server.getPort(),
                running: server.isRunning() || this.previouslyRunning.has(hostId)
            });
        });
        return state;
    }

    /**
     * Restore persistence state
     */
    restoreServiceState(state: { hostId: string; files: WebFile[]; port?: number; running: boolean }[], hosts: Host[]): void {
        hosts?.forEach(host => assertRuntimeOwner(host, this.owner));
        this.servers.forEach(server => server.stop());
        this.servers.clear();
        this.previouslyRunning.clear();

        state.forEach(s => {
            const host = hosts.find(h => h.getId() === s.hostId);
            if (host) {
                const server = new WebServer(host,false);
                this.servers.set(s.hostId,server);
                server.setFiles(s.files);
                server.setPort(s.port ?? 80);
                if (s.running) {
                    this.previouslyRunning.add(s.hostId);
                    // Do not start immediately! Main app controls when to start (simulation mode)
                }
            }
        });
    }

    clear(): void {
        this.servers.forEach(server => server.stop());
        this.servers.clear();
        this.previouslyRunning.clear();
    }
}

export const hostServerManager = new HostServerManager();
