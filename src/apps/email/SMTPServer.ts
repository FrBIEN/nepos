// SMTP Server - Simple Mail Transfer Protocol server implementation

import { Host } from '../../hardware/Host';
import { Socket, createTCPSocket, SocketMessage } from '../../transport/Socket';
import { Email, SMTPResponse } from './Email';

export const SMTP_PORT = 25;

/**
 * SMTP connection state machine
 */
enum SMTPState {
    START = 'START',           // Waiting for HELO/EHLO
    ENVELOPE = 'ENVELOPE',     // Receiving MAIL FROM, RCPT TO
    DATA = 'DATA',             // Receiving email content
    END = 'END'                // Transaction complete
}

/**
 * Represents one SMTP client connection
 */
interface SMTPSession {
    state: SMTPState;
    clientIP: string;
    mailFrom: string | null;
    rcptTo: string[];
    dataBuffer: string;
}

/**
 * Callback interface for email delivery
 */
export interface EmailDeliveryHandler {
    /**
     * Called when an email should be delivered locally
     * @returns true if recipient exists and email was delivered
     */
    deliverLocal(email: Email, recipient: string): boolean;

    /**
     * Called when an email should be forwarded to another domain
     */
    forwardEmail(email: Email, sender: string, recipients: string[]): void;

    /**
     * Check if a recipient is on this server's domain
     */
    isLocalDomain(recipient: string): boolean;
    hasRecipient(recipient: string): boolean;

    /**
     * Get the mail domain for this server
     */
    getMailDomain(): string;

    /**
     * Log a message to observers
     */
    log(message: string): void;

    /**
     * Send a bounce/NDR (Non-Delivery Report) message
     */
    sendBounce(originalEmail: Email, sender: string, failedRecipients: string[], reason: string): void;
}

/**
 * SMTP Server - Handles incoming mail on port 25
 */
export class SMTPServer {
    private host: Host;
    private port: number = SMTP_PORT;
    private socket: Socket | null = null;
    private running: boolean = false;
    private sessions: Map<string, SMTPSession> = new Map();
    private deliveryHandler: EmailDeliveryHandler | null = null;

    constructor(host: Host, deliveryHandler?: EmailDeliveryHandler) {
        this.host = host;
        this.deliveryHandler = deliveryHandler || null;
    }

    setDeliveryHandler(handler: EmailDeliveryHandler): void {
        this.deliveryHandler = handler;
    }

    start(): boolean {
        if (this.running) return false;

        this.socket = createTCPSocket(this.host);
        try {
            if (!this.socket.bind(this.port, '0.0.0.0') || !this.socket.listen()) throw new Error('Port bereits belegt');
            this.socket.onData(this.handleData.bind(this));
            // Send greeting when new client connects
            this.socket.onDisconnect(remote => this.sessions.delete(`${remote.ip}:${remote.port}`));
            this.socket.onAccept((clientInfo) => {
                this.handleNewConnection(clientInfo);
            });
            this.running = true;
            console.log(`[SMTPServer] Started on ${this.host.getIP()}:${this.port}`);
            return true;
        } catch (e) {
            console.error('[SMTPServer] Failed to start:', e);
            return false;
        }
    }

    stop(): void {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.sessions.clear();
        this.running = false;
        console.log('[SMTPServer] Stopped');
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
        const session: SMTPSession = {
            state: SMTPState.START,
            clientIP: clientInfo.ip,
            mailFrom: null,
            rcptTo: [],
            dataBuffer: ''
        };
        this.sessions.set(clientKey, session);

        // Send greeting immediately
        this.sendResponse(clientInfo, `${SMTPResponse.READY} ${this.getMailDomain()} ESMTP Filius`);
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
            // Create one, but don't send greeting (client should send first command)
            session = {
                state: SMTPState.START,
                clientIP: message.source.ip,
                mailFrom: null,
                rcptTo: [],
                dataBuffer: ''
            };
            this.sessions.set(clientKey, session);
        }

        // Process each line
        const lines = data.split(/\r?\n/);
        for (const line of lines) {
            if (line.trim() === '') continue;
            this.processCommand(session, line, message.source);
        }
    }

    private processCommand(session: SMTPSession, command: string, source: { ip: string; port: number }): void {
        const clientKey = `${source.ip}:${source.port}`;
        this.log(`${clientKey}< ${command}`);

        // QUIT can be sent in any state
        if (command.trim().toUpperCase() === 'QUIT') {
            this.sendResponse(source, `${SMTPResponse.CLOSING} Bye`);
            this.sessions.delete(clientKey);
            return;
        }

        // Handle based on state
        switch (session.state) {
            case SMTPState.START:
                this.handleStartState(session, command, source);
                break;

            case SMTPState.ENVELOPE:
                this.handleEnvelopeState(session, command, source);
                break;

            case SMTPState.DATA:
                this.handleDataState(session, command, source);
                break;

            case SMTPState.END:
                // Ready for new transaction
                session.state = SMTPState.ENVELOPE;
                session.mailFrom = null;
                session.rcptTo = [];
                session.dataBuffer = '';
                this.handleEnvelopeState(session, command, source);
                break;
        }
    }

    private handleStartState(session: SMTPSession, command: string, source: { ip: string; port: number }): void {
        const parts = command.split(' ');
        const cmd = parts[0].toUpperCase();

        if (cmd === 'HELO' || cmd === 'EHLO') {
            const clientName = parts[1] || 'unknown';
            this.sendResponse(source, `${SMTPResponse.OK} Hello ${clientName}`);
            session.state = SMTPState.ENVELOPE;
        } else if (cmd === 'NOOP') {
            this.sendResponse(source, `${SMTPResponse.OK} OK`);
        } else {
            this.sendResponse(source, `${SMTPResponse.BAD_SEQUENCE} Send HELO/EHLO first`);
        }
    }

    private handleEnvelopeState(session: SMTPSession, command: string, source: { ip: string; port: number }): void {
        const colonIndex = command.indexOf(':');
        const cmd = (colonIndex > 0 ? command.substring(0, colonIndex) : command).trim().toUpperCase();
        const data = colonIndex > 0 ? command.substring(colonIndex + 1).trim() : '';

        if (cmd === 'MAIL FROM') {
            const address = this.extractAddress(data);
            if (address) {
                session.mailFrom = address;
                this.sendResponse(source, `${SMTPResponse.OK} OK`);
            } else {
                this.sendResponse(source, `${SMTPResponse.SYNTAX_ERROR_PARAMS} Syntax error in MAIL FROM`);
            }
        } else if (cmd === 'RCPT TO') {
            const address = this.extractAddress(data);
            if (address && this.deliveryHandler?.isLocalDomain(address) && !this.deliveryHandler.hasRecipient(address)) {
                this.sendResponse(source, '550 Mailbox unavailable');
            } else if (address) {
                session.rcptTo.push(address);
                this.sendResponse(source, `${SMTPResponse.OK} OK`);
            } else {
                this.sendResponse(source, `${SMTPResponse.SYNTAX_ERROR_PARAMS} Syntax error in RCPT TO`);
            }
        } else if (cmd === 'DATA') {
            if (session.mailFrom && session.rcptTo.length > 0) {
                this.sendResponse(source, `${SMTPResponse.START_DATA} End data with <CR><LF>.<CR><LF>`);
                session.state = SMTPState.DATA;
                session.dataBuffer = '';
            } else {
                this.sendResponse(source, `${SMTPResponse.BAD_SEQUENCE} Need MAIL FROM and RCPT TO first`);
            }
        } else if (cmd === 'NOOP') {
            this.sendResponse(source, `${SMTPResponse.OK} OK`);
        } else if (cmd === 'RSET') {
            session.mailFrom = null;
            session.rcptTo = [];
            session.dataBuffer = '';
            this.sendResponse(source, `${SMTPResponse.OK} OK`);
        } else {
            this.sendResponse(source, `${SMTPResponse.SYNTAX_ERROR} Unknown command`);
        }
    }

    private handleDataState(session: SMTPSession, command: string, source: { ip: string; port: number }): void {
        // Check for end of data marker (single dot on a line)
        const lines = command.split(/\r?\n/);

        for (const line of lines) {
            if (line.trim() === '.') {
                // End of message
                this.processEmail(session, source);
                session.state = SMTPState.END;
                return;
            }
            // Handle dot-stuffing (lines starting with . that aren't end markers)
            const actualLine = line.startsWith('..') ? line.substring(1) : line;
            session.dataBuffer += actualLine + '\n';
        }
    }

    private processEmail(session: SMTPSession, source: { ip: string; port: number }): void {
        console.log('[SMTPServer] Processing email, dataBuffer:', session.dataBuffer);
        const email = new Email(session.dataBuffer);
        console.log('[SMTPServer] Parsed email - from:', email.getFrom()?.getMailAddress(),
            'to:', email.getTo().map(t => t.getMailAddress()),
            'subject:', email.getSubject(),
            'body:', email.getBody().substring(0, 100));

        // Set timestamp
        email.setDateReceived(new Date().toISOString());

        const localRecipients: string[] = [];
        const remoteRecipients: string[] = [];

        // Sort recipients by domain
        for (const rcpt of session.rcptTo) {
            if (this.deliveryHandler?.isLocalDomain(rcpt)) {
                localRecipients.push(rcpt);
            } else {
                remoteRecipients.push(rcpt);
            }
        }

        // Deliver to local recipients
        const unknownRecipients: string[] = [];
        for (const rcpt of localRecipients) {
            const delivered = this.deliveryHandler?.deliverLocal(email.clone(), rcpt);
            if (!delivered) {
                unknownRecipients.push(rcpt);
            } else {
                this.log(`Email delivered to ${rcpt}`);
            }
        }

        // Forward to remote recipients
        if (remoteRecipients.length > 0 && this.deliveryHandler) {
            this.deliveryHandler.forwardEmail(email.clone(), session.mailFrom || '', remoteRecipients);
        }

        // Send response
        if (unknownRecipients.length === 0) {
            this.sendResponse(source, `${SMTPResponse.OK} OK: queued`);
        } else {
            // Still accept but log warning and send bounce
            this.sendResponse(source, `${SMTPResponse.OK} OK: queued (some recipients unknown)`);
            this.log(`Unknown recipients: ${unknownRecipients.join(', ')}`);

            if (session.mailFrom) {
                this.deliveryHandler?.sendBounce(
                    email,
                    session.mailFrom,
                    unknownRecipients,
                    'User not found'
                );
            }
        }
    }

    private extractAddress(data: string): string | null {
        // Extract email from format like <user@domain.de> or user@domain.de
        const match = data.match(/<([^>]+)>/) || data.match(/(\S+@\S+)/);
        return match ? match[1] : null;
    }

    private sendResponse(destination: { ip: string; port: number }, response: string): void {
        if (this.socket) {
            this.socket.send(response + '\r\n', destination);
            this.log(`${destination.ip}:${destination.port}> ${response}`);
        }
    }

    private getMailDomain(): string {
        return this.deliveryHandler?.getMailDomain() || 'localhost';
    }

    private log(message: string): void {
        this.deliveryHandler?.log(`[SMTP] ${message}`);
    }
}
