import { legacyRuntime } from '../../runtime/LegacyRuntime';

// SMTPClient - SMTP client for sending emails

import { Host } from '../../hardware/Host';
import { Socket, createTCPSocket, SocketMessage } from '../../transport/Socket';
import { Email, SMTPResponse } from './Email';
import { SMTP_PORT } from './SMTPServer';

/**
 * SMTP client state machine
 */
enum SMTPClientState {
    DISCONNECTED = 'DISCONNECTED',
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    HELO_SENT = 'HELO_SENT',
    MAIL_FROM_SENT = 'MAIL_FROM_SENT',
    RCPT_TO_SENT = 'RCPT_TO_SENT',
    DATA_SENT = 'DATA_SENT',
    SENDING_DATA = 'SENDING_DATA',
    QUIT_SENT = 'QUIT_SENT'
}

/**
 * Result of sending an email
 */
export interface SendResult {
    success: boolean;
    message: string;
}

/**
 * SMTPClient - Sends emails via SMTP protocol
 */
export class SMTPClient {
    private get runtime() { return this.host?.runtime ?? legacyRuntime; }

    private host: Host;
    private socket: Socket | null = null;
    private state: SMTPClientState = SMTPClientState.DISCONNECTED;
    private responseBuffer: string = '';

    // Current transaction
    private currentEmail: Email | null = null;
    private currentSender: string = '';
    private currentRecipients: string[] = [];
    private recipientIndex: number = 0;
    private acceptedRecipients = 0;
    private releaseOperation: (() => void) | undefined;
    cancel(): void { this.fail('SMTP-Anfrage abgebrochen'); }
    private timeout: number | null = null;

    // Promise resolvers
    private resolveCallback: ((result: SendResult) => void) | null = null;
    private rejectCallback: ((error: Error) => void) | null = null;

    // Logging
    private logCallback: ((message: string) => void) | null = null;

    constructor(host: Host) {
        this.host = host;
    }

    /**
     * Set logging callback
     */
    setLogCallback(callback: (message: string) => void): void {
        this.logCallback = callback;
    }

    /**
     * Send an email to a server
     * @param serverIP IP address of the SMTP server
     * @param email The email to send
     * @param sender Sender address (envelope FROM)
     * @param recipients Recipient addresses (envelope RCPT TO)
     * @param port SMTP port (default 25)
     */
    async sendEmail(
        serverIP: string,
        email: Email,
        sender: string,
        recipients: string[],
        port: number = SMTP_PORT
    ): Promise<SendResult> {
        if (this.state !== SMTPClientState.DISCONNECTED) {
            return { success: false, message: 'Client busy' };
        }

        this.currentEmail = email;
        this.currentSender = sender;
        this.currentRecipients = recipients;
        this.recipientIndex = 0; this.acceptedRecipients = 0;
        this.responseBuffer = '';

        return new Promise((resolve, reject) => {
            this.releaseOperation = this.runtime.operations.track(() => this.cancel());
            this.resolveCallback = resolve;
            this.rejectCallback = reject;

            this.socket = createTCPSocket(this.host);
            this.socket.onConnect(this.handleConnect.bind(this));
            this.socket.onData(this.handleData.bind(this));
            this.socket.onClose(this.handleClose.bind(this));
            this.socket.onError(this.handleError.bind(this));

            this.state = SMTPClientState.CONNECTING;
            this.timeout = this.runtime.simulation.setTimeout(() => this.fail('SMTP-Zeitüberschreitung'), 30000);
            this.log(`Connecting to ${serverIP}:${port}...`);

            const success = this.socket.connect(serverIP, port);
            if (!success) {
                this.state = SMTPClientState.DISCONNECTED;
                resolve({ success: false, message: 'Connection failed' });
            }
        });
    }

    private handleConnect(): void {
        this.log('Connected, waiting for greeting...');
        this.state = SMTPClientState.CONNECTED;
        // Wait for server greeting (handled in handleData)
    }

    private handleData(message: SocketMessage): void {
        const data = typeof message.data === 'string' ? message.data : String(message.data);
        this.responseBuffer += data;

        // Process complete lines
        const lines = this.responseBuffer.split(/\r?\n/);
        this.responseBuffer = lines.pop() || ''; // Keep incomplete line

        for (const line of lines) {
            if (line.trim()) {
                this.processResponse(line);
            }
        }
    }

    private processResponse(response: string): void {
        this.log(`< ${response}`);

        const code = response.substring(0, 3);
        const isMultiline = response.charAt(3) === '-';

        if (isMultiline) {
            // Wait for more lines
            return;
        }

        // Process based on state
        switch (this.state) {
            case SMTPClientState.CONNECTED:
                if (code === SMTPResponse.READY) {
                    // Server ready, send HELO
                    this.sendCommand(`HELO ${this.host.getHostname()}`);
                    this.state = SMTPClientState.HELO_SENT;
                } else {
                    this.fail(`Unexpected greeting: ${response}`);
                }
                break;

            case SMTPClientState.HELO_SENT:
                if (code === SMTPResponse.OK) {
                    // HELO accepted, send MAIL FROM
                    this.sendCommand(`MAIL FROM:<${this.currentSender}>`);
                    this.state = SMTPClientState.MAIL_FROM_SENT;
                } else {
                    this.fail(`HELO rejected: ${response}`);
                }
                break;

            case SMTPClientState.MAIL_FROM_SENT:
                if (code === SMTPResponse.OK) {
                    // MAIL FROM accepted, send first RCPT TO
                    this.sendNextRecipient();
                } else {
                    this.fail(`MAIL FROM rejected: ${response}`);
                }
                break;

            case SMTPClientState.RCPT_TO_SENT:
                if (code === SMTPResponse.OK) {
                    this.acceptedRecipients++;
                    // RCPT TO accepted, send next or DATA
                    this.recipientIndex++;
                    if (this.recipientIndex < this.currentRecipients.length) {
                        this.sendNextRecipient();
                    } else {
                        this.sendCommand('DATA');
                        this.state = SMTPClientState.DATA_SENT;
                    }
                } else {
                    // Recipient rejected, but continue with others
                    this.log(`Recipient rejected: ${this.currentRecipients[this.recipientIndex]}`);
                    this.recipientIndex++;
                    if (this.recipientIndex < this.currentRecipients.length) {
                        this.sendNextRecipient();
                    } else if (this.acceptedRecipients > 0) {
                        // At least one recipient accepted
                        this.sendCommand('DATA');
                        this.state = SMTPClientState.DATA_SENT;
                    } else {
                        this.fail('All recipients rejected');
                    }
                }
                break;

            case SMTPClientState.DATA_SENT:
                if (code === SMTPResponse.START_DATA) {
                    // Server ready for data
                    this.sendEmailData();
                } else {
                    this.fail(`DATA rejected: ${response}`);
                }
                break;

            case SMTPClientState.SENDING_DATA:
                if (code === SMTPResponse.OK) {
                    // Email queued, send QUIT
                    this.sendCommand('QUIT');
                    this.state = SMTPClientState.QUIT_SENT;
                } else {
                    this.fail(`Email rejected: ${response}`);
                }
                break;

            case SMTPClientState.QUIT_SENT:
                // Done, close connection
                this.succeed('Email sent successfully');
                break;
        }
    }

    private sendNextRecipient(): void {
        const recipient = this.currentRecipients[this.recipientIndex];
        this.sendCommand(`RCPT TO:<${recipient}>`);
        this.state = SMTPClientState.RCPT_TO_SENT;
    }

    private sendEmailData(): void {
        if (!this.currentEmail || !this.socket) return;

        this.state = SMTPClientState.SENDING_DATA;

        // Send email content
        const content = this.currentEmail.toString();

        // Dot-stuff lines starting with .
        const lines = content.split('\n');
        const stuffedLines = lines.map(line =>
            line.startsWith('.') ? '.' + line : line
        );

        // Send content followed by terminating sequence
        this.socket.send(stuffedLines.join('\r\n') + '\r\n.\r\n');
        this.log('> [Email data sent]');
    }

    private sendCommand(command: string): void {
        if (this.socket) {
            this.socket.send(command + '\r\n');
            this.log(`> ${command}`);
        }
    }

    private handleClose(): void {
        // Guard against being called after cleanup
        if (!this.socket) return;

        if (this.state !== SMTPClientState.DISCONNECTED) {
            if (this.resolveCallback) {
                this.resolveCallback({ success: false, message: 'Connection closed unexpectedly' });
            }
        }
        this.cleanup();
    }

    private handleError(error: Error): void {
        this.log(`Error: ${error.message}`);
        if (this.rejectCallback) {
            this.rejectCallback(error);
        }
        this.cleanup();
    }

    private succeed(message: string): void {
        this.log(message);
        if (this.resolveCallback) {
            this.resolveCallback({ success: true, message });
        }
        this.close();
    }

    private fail(message: string): void {
        this.log(`Failed: ${message}`);
        if (this.resolveCallback) {
            this.resolveCallback({ success: false, message });
        }
        this.close();
    }

    private close(): void {
        if (this.socket) {
            this.socket.close();
        }
        this.cleanup();
    }

    private cleanup(): void {
        this.releaseOperation?.(); this.releaseOperation = undefined;
        if (this.timeout !== null) this.runtime.simulation.clearTimeout(this.timeout); this.timeout = null;
        const socket = this.socket; this.socket = null;
        this.state = SMTPClientState.DISCONNECTED;
        this.currentEmail = null;
        this.currentSender = '';
        this.currentRecipients = [];
        this.recipientIndex = 0; this.acceptedRecipients = 0;
        this.resolveCallback = null;
        this.rejectCallback = null; socket?.close();
    }

    private log(message: string): void {
        if (this.logCallback) {
            this.logCallback(`[SMTPClient] ${message}`);
        }
        console.log(`[SMTPClient] ${message}`);
    }
}
