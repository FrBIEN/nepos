// POP3 Server - Post Office Protocol version 3 server implementation

import { Host } from '../../hardware/Host';
import { Socket, createTCPSocket, SocketMessage } from '../../transport/Socket';
import { EmailAccount, POP3Response } from './Email';

export const POP3_PORT = 110;

/**
 * POP3 connection state machine
 */
enum POP3State {
    AUTHORIZATION = 'AUTHORIZATION',  // Waiting for USER/PASS
    TRANSACTION = 'TRANSACTION'       // Logged in, can retrieve mail
}

/**
 * Represents one POP3 client session
 */
interface POP3Session {
    state: POP3State;
    clientIP: string;
    username: string | null;
    account: EmailAccount | null;
}

/**
 * Callback interface for account lookup
 */
export interface AccountHandler {
    /**
     * Find account by username
     */
    findAccount(username: string): EmailAccount | null;

    /**
     * Validate username and password
     */
    validateCredentials(username: string, password: string): EmailAccount | null;

    /**
     * Save accounts after modifications
     */
    saveAccounts(): void;

    /**
     * Log a message
     */
    log(message: string): void;
}

/**
 * POP3 Server - Handles mail retrieval on port 110
 */
export class POP3Server {
    private host: Host;
    private port: number = POP3_PORT;
    private socket: Socket | null = null;
    private running: boolean = false;
    private sessions: Map<string, POP3Session> = new Map();
    private accountHandler: AccountHandler | null = null;

    constructor(host: Host, accountHandler?: AccountHandler) {
        this.host = host;
        this.accountHandler = accountHandler || null;
    }

    setAccountHandler(handler: AccountHandler): void {
        this.accountHandler = handler;
    }

    start(): boolean {
        if (this.running) return false;

        this.socket = createTCPSocket(this.host);
        try {
            if (!this.socket.bind(this.port, '0.0.0.0') || !this.socket.listen()) throw new Error('Port bereits belegt');
            this.socket.onData(this.handleData.bind(this));
            // Send greeting when new client connects
            this.socket.onDisconnect(remote => { const key=`${remote.ip}:${remote.port}`; this.sessions.get(key)?.account?.resetDeletions(); this.sessions.delete(key); });
            this.socket.onAccept((clientInfo) => {
                this.handleNewConnection(clientInfo);
            });
            this.running = true;
            console.log(`[POP3Server] Started on ${this.host.getIP()}:${this.port}`);
            return true;
        } catch (e) {
            console.error('[POP3Server] Failed to start:', e);
            return false;
        }
    }

    stop(): void {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        for (const session of this.sessions.values()) session.account?.resetDeletions();
        this.sessions.clear();
        this.running = false;
        console.log('[POP3Server] Stopped');
    }

    isRunning(): boolean {
        return this.running;
    }

    getPort(): number {
        return this.port;
    }

    setPort(port: number): void {
        this.port = port;
    }

    /**
     * Called when a new client connects (TCP handshake complete)
     */
    private handleNewConnection(clientInfo: { ip: string; port: number }): void {
        const clientKey = `${clientInfo.ip}:${clientInfo.port}`;

        // Create session for new client
        const session: POP3Session = {
            state: POP3State.AUTHORIZATION,
            clientIP: clientInfo.ip,
            username: null,
            account: null
        };
        this.sessions.set(clientKey, session);

        // Send greeting immediately
        this.sendResponse(clientInfo, `${POP3Response.OK} POP3 server ready`);
        this.log(`${clientKey}> New connection`);
    }

    private handleData(message: SocketMessage): void {
        if (!message.source) return;

        const clientKey = `${message.source.ip}:${message.source.port}`;
        const data = typeof message.data === 'string' ? message.data : String(message.data);

        // Get session (should exist from onAccept)
        let session = this.sessions.get(clientKey);
        if (!session) {
            // Session might not exist if connection was established before we saw it
            session = {
                state: POP3State.AUTHORIZATION,
                clientIP: message.source.ip,
                username: null,
                account: null
            };
            this.sessions.set(clientKey, session);
        }

        // Process command
        const command = data.trim();
        if (command) {
            this.processCommand(session, command, message.source);
        }
    }

    private processCommand(session: POP3Session, command: string, source: { ip: string; port: number }): void {
        const clientKey = `${source.ip}:${source.port}`;
        this.log(`${clientKey}< ${command}`);

        const parts = command.split(' ');
        const cmd = parts[0].toUpperCase();
        const arg = parts[1] || '';

        // QUIT can be sent in any state
        if (cmd === 'QUIT') {
            this.handleQuit(session, source);
            return;
        }

        // Handle based on state
        if (session.state === POP3State.AUTHORIZATION) {
            this.handleAuthorizationCommand(session, cmd, arg, source);
        } else {
            this.handleTransactionCommand(session, cmd, arg, source);
        }
    }

    private handleAuthorizationCommand(
        session: POP3Session,
        cmd: string,
        arg: string,
        source: { ip: string; port: number }
    ): void {
        switch (cmd) {
            case 'USER':
                if (!arg) {
                    this.sendResponse(source, `${POP3Response.ERR} Missing username`);
                    return;
                }
                // Check if user exists
                const account = this.accountHandler?.findAccount(arg);
                if (account) {
                    session.username = arg;
                    this.sendResponse(source, `${POP3Response.OK} enter password`);
                } else {
                    this.sendResponse(source, `${POP3Response.ERR} user or password wrong`);
                }
                break;

            case 'PASS':
                if (!session.username) {
                    this.sendResponse(source, `${POP3Response.ERR} Please enter USER first`);
                    return;
                }
                if (!arg) {
                    this.sendResponse(source, `${POP3Response.ERR} Missing password`);
                    return;
                }
                // Validate credentials
                const validAccount = this.accountHandler?.validateCredentials(session.username, arg);
                if (validAccount && [...this.sessions.values()].some(other=>other!==session && other.account===validAccount && other.state===POP3State.TRANSACTION)) { this.sendResponse(source, `${POP3Response.ERR} Mailbox already locked`); return; }
                if (validAccount) {
                    session.account = validAccount;
                    session.state = POP3State.TRANSACTION;
                    this.sendResponse(source, `${POP3Response.OK} Mailbox locked and ready`);
                } else {
                    session.username = null;
                    this.sendResponse(source, `${POP3Response.ERR} user or password wrong`);
                }
                break;

            case 'NOOP':
                this.sendResponse(source, `${POP3Response.ERR} Not authenticated`);
                break;

            default:
                this.sendResponse(source, `${POP3Response.ERR} Unknown command`);
        }
    }

    private handleTransactionCommand(
        session: POP3Session,
        cmd: string,
        arg: string,
        source: { ip: string; port: number }
    ): void {
        if (!session.account) {
            this.sendResponse(source, `${POP3Response.ERR} Not authenticated`);
            return;
        }

        switch (cmd) {
            case 'STAT':
                this.handleStat(session, source);
                break;

            case 'LIST':
                if (arg) {
                    this.handleListSingle(session, Number(arg), source);
                } else {
                    this.handleListAll(session, source);
                }
                break;

            case 'RETR':
                if (!arg) {
                    this.sendResponse(source, `${POP3Response.ERR} Missing message number`);
                    return;
                }
                this.handleRetr(session, Number(arg), source);
                break;

            case 'DELE':
                if (!arg) {
                    this.sendResponse(source, `${POP3Response.ERR} Missing message number`);
                    return;
                }
                this.handleDele(session, Number(arg), source);
                break;

            case 'RSET':
                this.handleRset(session, source);
                break;

            case 'NOOP':
                this.sendResponse(source, `${POP3Response.OK}`);
                break;

            case 'TOP':
                const [messageNumber,lineCount]=arg.split(/\s+/).map(Number), top=session.account.getMessages()[messageNumber-1];
                if (!Number.isInteger(messageNumber) || !Number.isInteger(lineCount) || lineCount<0 || !top || top.isMarkedForDelete()) { this.sendResponse(source, '-ERR no such message'); break; }
                const text=top.toString().split(/\r?\n/), boundary=text.indexOf(''), selected=text.slice(0,boundary+1).concat(text.slice(boundary+1,boundary+1+lineCount));
                this.sendResponse(source, `+OK top of message follows\r\n${selected.map(line=>line.startsWith('.')?'.'+line:line).join('\r\n')}\r\n.`);
                break;

            case 'UIDL':
                const messages=session.account.getMessages();
                if(arg){ const index=Number(arg), message=messages[index-1]; this.sendResponse(source,Number.isInteger(index)&&message&&!message.isMarkedForDelete()?`+OK ${index} ${message.getUID()}`:'-ERR no such message'); }
                else this.sendResponse(source, `+OK unique-id listing follows\r\n${messages.map((message,index)=>message.isMarkedForDelete()?'':`${index+1} ${message.getUID()}\r\n`).join('')}.`);
                break;

            default:
                this.sendResponse(source, `${POP3Response.ERR} Unknown command`);
        }
    }

    private handleStat(session: POP3Session, source: { ip: string; port: number }): void {
        const account = session.account!;
        const count = account.getMessageCount();
        const size = account.getTotalSize();
        this.sendResponse(source, `${POP3Response.OK} ${count} ${size}`);
    }

    private handleListAll(session: POP3Session, source: { ip: string; port: number }): void {
        const account = session.account!;
        const messages = account.getMessages();
        const count = account.getMessageCount();
        const size = account.getTotalSize();

        let response = `${POP3Response.OK} ${count} messages (${size} octets)\r\n`;

        let index = 1;
        for (const msg of messages) {
            if (!msg.isMarkedForDelete()) {
                response += `${index} ${msg.getSize()}\r\n`;
            }
            index++;
        }
        response += '.';

        this.sendResponse(source, response);
    }

    private handleListSingle(session: POP3Session, msgNum: number, source: { ip: string; port: number }): void {
        const account = session.account!;
        const messages = account.getMessages();

        if (msgNum < 1 || msgNum > messages.length) {
            this.sendResponse(source, `${POP3Response.ERR} no such message`);
            return;
        }

        const msg = messages[msgNum - 1];
        if (msg.isMarkedForDelete()) {
            this.sendResponse(source, `${POP3Response.ERR} message marked for delete`);
            return;
        }

        this.sendResponse(source, `${POP3Response.OK} ${msgNum} ${msg.getSize()}`);
    }

    private handleRetr(session: POP3Session, msgNum: number, source: { ip: string; port: number }): void {
        const account = session.account!;
        const messages = account.getMessages();

        if (msgNum < 1 || msgNum > messages.length) {
            this.sendResponse(source, `${POP3Response.ERR} no such message`);
            return;
        }

        const msg = messages[msgNum - 1];
        if (msg.isMarkedForDelete()) {
            this.sendResponse(source, `${POP3Response.ERR} message marked for delete`);
            return;
        }

        // Mark as retrieved (no longer "new")
        msg.setIsNew(false);

        const response = `${POP3Response.OK} message follows\r\n${msg.toString().split(/\r?\n/).map(line => line.startsWith('.') ? '.' + line : line).join('\r\n')}\r\n.`;
        this.sendResponse(source, response);
    }

    private handleDele(session: POP3Session, msgNum: number, source: { ip: string; port: number }): void {
        const account = session.account!;
        const messages = account.getMessages();

        if (msgNum < 1 || msgNum > messages.length) {
            this.sendResponse(source, `${POP3Response.ERR} no such message`);
            return;
        }

        const msg = messages[msgNum - 1];
        if (msg.isMarkedForDelete()) {
            this.sendResponse(source, `${POP3Response.ERR} message already marked for delete`);
            return;
        }

        msg.setMarkedForDelete(true);
        this.sendResponse(source, `${POP3Response.OK} message marked for delete`);
    }

    private handleRset(session: POP3Session, source: { ip: string; port: number }): void {
        const account = session.account!;
        account.resetDeletions();
        this.sendResponse(source, `${POP3Response.OK}`);
    }

    private handleQuit(session: POP3Session, source: { ip: string; port: number }): void {
        const clientKey = `${source.ip}:${source.port}`;

        // Apply deletions if in transaction state
        if (session.state === POP3State.TRANSACTION && session.account) {
            session.account.applyDeletions();
            this.accountHandler?.saveAccounts();
        }

        this.sendResponse(source, `${POP3Response.OK}`);
        this.sessions.delete(clientKey);
    }

    private sendResponse(destination: { ip: string; port: number }, response: string): void {
        if (this.socket) {
            this.socket.send(response + '\r\n', destination);

            // Log first line only for multi-line responses
            const firstLine = response.split('\r\n')[0];
            this.log(`${destination.ip}:${destination.port}> ${firstLine}`);
        }
    }

    private log(message: string): void {
        this.accountHandler?.log(`[POP3] ${message}`);
    }
}
