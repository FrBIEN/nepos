import { Host } from '../hardware/Host';
import { Socket, createTCPSocket, SocketMessage } from '../transport/Socket';

export class SimpleClient {
    private generation=0;
    private host: Host;
    private socket: Socket | null = null;
    private onMessage: ((msg: string) => void) | null = null;
    private onStatusChange: ((status: string) => void) | null = null;

    constructor(host: Host) {
        this.host = host;
    }

    async connect(destination: string, port: number): Promise<void> {
        if (this.socket) {
            this.disconnect();
        }

        const generation=++this.generation;
        this.updateStatus(`Löse ${destination} auf...`);
        try {
            const ip=await this.host.resolveHost(destination);
            if(generation!==this.generation)return;
            if(!ip)throw new Error(`Konnte ${destination} nicht auflösen`);
            this.initiateTCP(ip,port);
        } catch(error){if(generation===this.generation)this.updateStatus(`Verbindungsfehler: ${error}`);}
    }

    private initiateTCP(ip: string, port: number): void {
        try {
            this.updateStatus('Verbinde...');
            this.socket = createTCPSocket(this.host);

            this.socket.onData((msg: SocketMessage) => {
                const text = typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data);
                if (this.onMessage) this.onMessage(text);
            });

            this.socket.onClose(() => {
                this.updateStatus('Verbindung getrennt');
            });

            this.socket.onError((err) => {
                this.updateStatus(`Fehler: ${err.message}`);
                this.socket?.close(); this.socket = null;
            });

            this.socket.onConnect(() => {
                this.updateStatus(`Verbunden mit ${ip}:${port}`);
            });

            const success = this.socket.connect(ip, port);
            if (!success) {
                this.updateStatus(`Verbindung fehlgeschlagen`);
                this.socket = null;
            }

        } catch (e) {
            this.updateStatus(`Verbindungsfehler: ${e}`);
        }
    }



    send(text: string): void {
        if (this.socket && this.socket.getState() === 'CONNECTED') {
            this.socket.send(text);
        } else {
            this.updateStatus('Nicht verbunden');
        }
    }

    disconnect(): void {
        this.generation++;
        if (this.socket) {
            this.socket.close();
            this.socket = null;
            this.updateStatus('Getrennt');
        }
    }

    onReceive(callback: (msg: string) => void): void {
        this.onMessage = callback;
    }

    onStatus(callback: (status: string) => void): void {
        this.onStatusChange = callback;
    }

    private updateStatus(status: string): void {
        if (this.onStatusChange) this.onStatusChange(status);
    }
}
