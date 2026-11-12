import { legacyRuntime } from '../../runtime/LegacyRuntime';

// POP3Client - POP3 client for retrieving emails

import { Host } from '../../hardware/Host';
import { Socket, createTCPSocket, SocketMessage } from '../../transport/Socket';
import { Email, POP3Response } from './Email';
import { POP3_PORT } from './POP3Server';

/**
 * POP3 client state machine
 */
enum POP3ClientState {
    DISCONNECTED = 'DISCONNECTED',
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    USER_SENT = 'USER_SENT',
    PASS_SENT = 'PASS_SENT',
    AUTHENTICATED = 'AUTHENTICATED',
    STAT_SENT = 'STAT_SENT',
    LIST_SENT = 'LIST_SENT',
    RETR_SENT = 'RETR_SENT',
    DELE_SENT = 'DELE_SENT',
    QUIT_SENT = 'QUIT_SENT'
}

/**
 * Mailbox statistics
 */
export interface MailboxStats {
    messageCount: number;
    totalSize: number;
}

/**
 * Message info from LIST
 */
export interface MessageInfo {
    index: number;
    size: number;
}

/**
 * Result of POP3 operations
 */
export interface POP3Result<T = void> {
    success: boolean;
    message: string;
    data?: T;
}

/**
 * POP3Client - Retrieves emails via POP3 protocol
 */
export class POP3Client {
    private get runtime() { return this.host?.runtime ?? legacyRuntime; }

    private host: Host;
    private socket: Socket | null = null;
    private state: POP3ClientState = POP3ClientState.DISCONNECTED;
    private responseBuffer: string = '';
    private multilineBuffer: string[] = [];
    private inMultiline: boolean = false;

    // Current operation
    private releaseOperation: (() => void) | undefined;
    cancel(): void { this.fail('POP3-Anfrage abgebrochen'); this.cleanup(); }
    private operationTimer: number | null = null;
    private schedule(callback: () => void, delay: number): void { if (this.operationTimer !== null) this.runtime.simulation.clearTimeout(this.operationTimer); this.operationTimer = this.runtime.simulation.setTimeout(() => { this.operationTimer = null; callback(); }, delay); }
    private currentOperation: string = '';

    // Promise resolvers
    private resolveCallback: ((result: POP3Result<any>) => void) | null = null;
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
     * Connect to POP3 server and authenticate
     */
    async connect(
        serverIP: string,
        username: string,
        password: string,
        port: number = POP3_PORT
    ): Promise<POP3Result> {
        if (this.state !== POP3ClientState.DISCONNECTED) {
            return { success: false, message: 'Client already connected' };
        }

        return new Promise((resolve, reject) => {
            this.resolveCallback = resolve;
            this.rejectCallback = reject;

            this.releaseOperation = this.runtime.operations.track(() => this.cancel());
            this.socket = createTCPSocket(this.host);
            this.socket.onConnect(() => this.handleConnect(username, password));
            this.socket.onData(this.handleData.bind(this));
            this.socket.onClose(this.handleClose.bind(this));
            this.socket.onError(this.handleError.bind(this));

            this.state = POP3ClientState.CONNECTING;
            this.schedule(() => { this.fail('POP3-Zeitüberschreitung'); this.cleanup(); }, 20000);
            this.log(`Connecting to ${serverIP}:${port}...`);

            const success = this.socket.connect(serverIP, port);
            if (!success) {
                this.state = POP3ClientState.DISCONNECTED;
                resolve({ success: false, message: 'Connection failed' });
            }
        });
    }

    /**
     * Get mailbox statistics (STAT)
     */
    async getStats(): Promise<POP3Result<MailboxStats>> {
        if (this.state !== POP3ClientState.AUTHENTICATED) {
            return { success: false, message: 'Not authenticated' };
        }

        return new Promise((resolve) => {
            this.resolveCallback = resolve;
            this.currentOperation = 'STAT';
            this.sendCommand('STAT');
            this.state = POP3ClientState.STAT_SENT;

            // Timeout to prevent hanging
            this.schedule(() => {
                if (this.state === POP3ClientState.STAT_SENT && this.resolveCallback) {
                    this.log('STAT timeout');
                    this.state = POP3ClientState.AUTHENTICATED;
                    this.resolveCallback({ success: false, message: 'STAT timeout' });
                    this.resolveCallback = null;
                }
            }, 5000);
        });
    }

    /**
     * List all messages (LIST)
     */
    async listMessages(): Promise<POP3Result<MessageInfo[]>> {
        if (this.state !== POP3ClientState.AUTHENTICATED) {
            return { success: false, message: 'Not authenticated' };
        }

        return new Promise((resolve) => {
            this.resolveCallback = resolve;
            this.currentOperation = 'LIST';
            this.multilineBuffer = [];
            this.inMultiline = false;
            this.sendCommand('LIST');
            this.state = POP3ClientState.LIST_SENT;

            // Timeout to prevent hanging
            this.schedule(() => {
                if (this.state === POP3ClientState.LIST_SENT && this.resolveCallback) {
                    this.log('LIST timeout');
                    this.state = POP3ClientState.AUTHENTICATED;
                    this.resolveCallback({ success: false, message: 'LIST timeout' });
                    this.resolveCallback = null;
                }
            }, 5000);
        });
    }

    /**
     * Retrieve a message (RETR)
     */
    async retrieveMessage(index: number): Promise<POP3Result<Email>> {
        if (this.state !== POP3ClientState.AUTHENTICATED) {
            return { success: false, message: 'Not authenticated' };
        }

        return new Promise((resolve) => {
            this.resolveCallback = resolve;
            this.currentOperation = 'RETR';
            this.multilineBuffer = [];
            this.inMultiline = false;
            this.sendCommand(`RETR ${index}`);
            this.state = POP3ClientState.RETR_SENT;

            // Timeout to prevent hanging forever
            this.schedule(() => {
                if (this.state === POP3ClientState.RETR_SENT && this.resolveCallback) {
                    this.log(`RETR timeout - inMultiline=${this.inMultiline}, buffer=${this.multilineBuffer.length} lines`);
                    this.state = POP3ClientState.AUTHENTICATED;
                    this.resolveCallback({ success: false, message: 'RETR timeout' });
                    this.resolveCallback = null;
                }
            }, 10000);
        });
    }

    /**
     * Mark a message for deletion (DELE)
     */
    async deleteMessage(index: number): Promise<POP3Result> {
        if (this.state !== POP3ClientState.AUTHENTICATED) {
            return { success: false, message: 'Not authenticated' };
        }

        return new Promise((resolve) => {
            this.resolveCallback = resolve;
            this.currentOperation = 'DELE';
            this.sendCommand(`DELE ${index}`);
            this.state = POP3ClientState.DELE_SENT;

            // Timeout to prevent hanging
            this.schedule(() => {
                if (this.state === POP3ClientState.DELE_SENT && this.resolveCallback) {
                    this.log('DELE timeout');
                    this.state = POP3ClientState.AUTHENTICATED;
                    this.resolveCallback({ success: false, message: 'DELE timeout' });
                    this.resolveCallback = null;
                }
            }, 5000);
        });
    }

    /**
     * Disconnect from server (QUIT)
     */
    async disconnect(): Promise<POP3Result> {
        if (this.state === POP3ClientState.DISCONNECTED) {
            return { success: true, message: 'Already disconnected' };
        }

        return new Promise((resolve) => {
            this.resolveCallback = (result) => {
                // Ensure cleanup runs even on async race
                this.cleanup();
                resolve(result);
            };
            this.currentOperation = 'QUIT';
            this.sendCommand('QUIT');
            this.state = POP3ClientState.QUIT_SENT;

            // Timeout to force cleanup if server doesn't respond
            this.schedule(() => {
                if (this.state === POP3ClientState.QUIT_SENT) {
                    this.cleanup();
                    resolve({ success: true, message: 'Disconnected (timeout)' });
                }
            }, 3000);
        });
    }

    /**
     * Force disconnect without sending QUIT
     */
    forceDisconnect(): void {
        this.cleanup();
    }

    /**
     * Check if connected and authenticated
     */
    isConnected(): boolean {
        return this.state === POP3ClientState.AUTHENTICATED;
    }

    // Private stored credentials for authentication flow
    private pendingUsername: string = '';
    private pendingPassword: string = '';

    private handleConnect(username: string, password: string): void {
        this.log('Connected, waiting for greeting...');
        this.state = POP3ClientState.CONNECTED;
        this.pendingUsername = username;
        this.pendingPassword = password;
    }

    private handleData(message: SocketMessage): void {
        const data = typeof message.data === 'string' ? message.data : String(message.data);
        this.responseBuffer += data;

        // Process complete lines
        const lines = this.responseBuffer.split(/\r?\n/);
        this.responseBuffer = lines.pop() || '';

        for (const line of lines) {
            this.processLine(line);
        }
    }

    private processLine(line: string): void {
        // Handle multiline responses
        if (this.inMultiline) {
            // Check for end-of-multiline marker (single dot on a line)
            if (line.trim() === '.' || line === '.') {
                // End of multiline
                this.inMultiline = false;
                this.log(`< [End of multiline: ${this.multilineBuffer.length} lines]`);
                this.processMultilineComplete();
            } else {
                // Undo dot-stuffing
                const actualLine = line.startsWith('..') ? line.substring(1) : line;
                this.multilineBuffer.push(actualLine);
            }
            return;
        }

        this.log(`< ${line}`);

        const isOK = line.startsWith(POP3Response.OK);
        const isERR = line.startsWith(POP3Response.ERR);

        if (!isOK && !isERR) {
            // Continuation of previous response or unexpected
            return;
        }

        // Process based on state
        switch (this.state) {
            case POP3ClientState.CONNECTED:
                if (isOK) {
                    // Server ready, send USER
                    this.sendCommand(`USER ${this.pendingUsername}`);
                    this.state = POP3ClientState.USER_SENT;
                } else {
                    this.fail(`Server not ready: ${line}`);
                }
                break;

            case POP3ClientState.USER_SENT:
                if (isOK) {
                    // USER accepted, send PASS
                    this.sendCommand(`PASS ${this.pendingPassword}`);
                    this.state = POP3ClientState.PASS_SENT;
                } else {
                    this.fail(`USER rejected: ${line}`);
                }
                break;

            case POP3ClientState.PASS_SENT:
                if (isOK) {
                    // Authenticated!
                    this.state = POP3ClientState.AUTHENTICATED;
                    this.succeed('Authenticated successfully');
                    // Clear stored credentials
                    this.pendingUsername = '';
                    this.pendingPassword = '';
                } else {
                    this.fail(`Authentication failed: ${line}`);
                }
                break;

            case POP3ClientState.STAT_SENT:
                if (isOK) {
                    // Parse "+OK count size"
                    const parts = line.split(' ');
                    const stats: MailboxStats = {
                        messageCount: parseInt(parts[1]) || 0,
                        totalSize: parseInt(parts[2]) || 0
                    };
                    this.state = POP3ClientState.AUTHENTICATED;
                    this.succeedWithData('Stats retrieved', stats);
                } else {
                    this.state = POP3ClientState.AUTHENTICATED;
                    this.fail(`STAT failed: ${line}`);
                }
                break;

            case POP3ClientState.LIST_SENT:
                if (isOK) {
                    // Start multiline response
                    this.inMultiline = true;
                    this.multilineBuffer = [];
                } else {
                    this.state = POP3ClientState.AUTHENTICATED;
                    this.fail(`LIST failed: ${line}`);
                }
                break;

            case POP3ClientState.RETR_SENT:
                if (isOK) {
                    // Start multiline response
                    this.inMultiline = true;
                    this.multilineBuffer = [];
                } else {
                    this.state = POP3ClientState.AUTHENTICATED;
                    this.fail(`RETR failed: ${line}`);
                }
                break;

            case POP3ClientState.DELE_SENT:
                this.state = POP3ClientState.AUTHENTICATED;
                if (isOK) {
                    this.succeed('Message marked for deletion');
                } else {
                    this.fail(`DELE failed: ${line}`);
                }
                break;

            case POP3ClientState.QUIT_SENT:
                // Connection will close
                this.succeed('Disconnected');
                this.cleanup();
                break;
        }
    }

    private processMultilineComplete(): void {
        switch (this.currentOperation) {
            case 'LIST':
                // Parse message list
                const messages: MessageInfo[] = [];
                for (const line of this.multilineBuffer) {
                    const parts = line.split(' ');
                    if (parts.length >= 2) {
                        messages.push({
                            index: parseInt(parts[0]),
                            size: parseInt(parts[1])
                        });
                    }
                }
                this.state = POP3ClientState.AUTHENTICATED;
                this.succeedWithData('Messages listed', messages);
                break;

            case 'RETR':
                // Parse email
                const emailContent = this.multilineBuffer.join('\n');
                console.log('[POP3Client] Email content received:', emailContent);
                const email = new Email(emailContent);
                console.log('[POP3Client] Parsed email - from:', email.getFrom()?.getMailAddress(),
                    'to:', email.getTo().map(t => t.getMailAddress()),
                    'subject:', email.getSubject(),
                    'body:', email.getBody().substring(0, 100));
                this.state = POP3ClientState.AUTHENTICATED;
                this.succeedWithData('Message retrieved', email);
                break;
        }
    }

    private sendCommand(command: string): void {
        if (this.socket) {
            // Mask password in logs
            const logCommand = command.startsWith('PASS ') ? 'PASS ****' : command;
            this.log(`> ${logCommand}`);
            this.socket.send(command + '\r\n');
        }
    }

    private handleClose(): void {
        // Guard against being called after cleanup (prevents recursion)
        if (!this.socket) return;

        if (this.state !== POP3ClientState.DISCONNECTED && this.state !== POP3ClientState.QUIT_SENT) {
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
        if (this.operationTimer !== null) this.runtime.simulation.clearTimeout(this.operationTimer); this.operationTimer = null;
        if (this.resolveCallback) {
            this.resolveCallback({ success: true, message });
            this.resolveCallback = null;
        }
    }

    private succeedWithData<T>(message: string, data: T): void {
        if (this.operationTimer !== null) this.runtime.simulation.clearTimeout(this.operationTimer); this.operationTimer = null;
        if (this.resolveCallback) {
            this.resolveCallback({ success: true, message, data });
            this.resolveCallback = null;
        }
    }

    private fail(message: string): void {
        this.log(`Failed: ${message}`);
        if (this.resolveCallback) {
            this.resolveCallback({ success: false, message });
            this.resolveCallback = null;
        }
    }

    private cleanup(): void {
        this.releaseOperation?.(); this.releaseOperation = undefined;
        if (this.operationTimer !== null) this.runtime.simulation.clearTimeout(this.operationTimer); this.operationTimer = null;
        // Store socket reference and nullify BEFORE closing to prevent recursion
        // (close triggers handleClose which calls cleanup again)
        const sock = this.socket;
        this.socket = null;
        this.state = POP3ClientState.DISCONNECTED;
        this.responseBuffer = '';
        this.multilineBuffer = [];
        this.inMultiline = false;
        this.pendingUsername = '';
        this.pendingPassword = '';
        this.resolveCallback = null;
        this.rejectCallback = null;

        // Now safe to close socket (handleClose will see socket is already null)
        if (sock) {
            sock.close();
        }
    }

    private log(message: string): void {
        if (this.logCallback) {
            this.logCallback(`[POP3Client] ${message}`);
        }
        console.log(`[POP3Client] ${message}`);
    }
}
