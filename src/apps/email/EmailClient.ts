import type { RuntimeDependencies } from '../../runtime/RuntimeDependencies';
import { assertRuntimeOwner } from '../../runtime/assertRuntimeOwner';
import { legacyRuntime } from '../../runtime/LegacyRuntime';
// EmailClient - End-user email application

import { Host } from '../../hardware/Host';
import { Email, EmailAccount } from './Email';
import { SMTPClient, SendResult } from './SMTPClient';
import { POP3Client, MessageInfo, POP3Result } from './POP3Client';
import { Events } from '../../core/EventBus';

/**
 * Folder types for email organization
 */
export type EmailFolder = 'inbox' | 'sent' | 'drafts';

/**
 * Email client status
 */
export interface EmailClientStatus {
    connected: boolean;
    lastError: string | null;
    messageCount: number;
}

/**
 * EmailClient - End-user email application
 * Combines SMTP sending and POP3 retrieval
 */
export class EmailClient {
    private get runtime() { return this.host?.runtime ?? legacyRuntime; }

    private host: Host;
    private account: EmailAccount | null = null;

    // Email storage (local)
    private inbox: Email[] = [];
    private sent: Email[] = [];
    private drafts: Email[] = [];

    // Clients
    private smtpClient: SMTPClient;
    private pop3Client: POP3Client;

    // Status
    private lastError: string | null = null;

    // Logging
    private logCallback: ((message: string) => void) | null = null;

    constructor(host: Host) {
        this.host = host;
        this.smtpClient = new SMTPClient(host);
        this.pop3Client = new POP3Client(host);
    }

    /**
     * Set logging callback for protocol messages
     */
    setLogCallback(callback: (message: string) => void): void {
        this.logCallback = callback;
        this.smtpClient.setLogCallback(callback);
        this.pop3Client.setLogCallback(callback);
    }

    /**
     * Configure email account
     */
    setAccount(account: EmailAccount): void {
        this.account = account;
        this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'email-client' });
    }

    /**
     * Get current account
     */
    getAccount(): EmailAccount | null {
        return this.account;
    }

    /**
     * Quick account setup
     */
    configureAccount(
        emailAddress: string,
        username: string,
        password: string,
        pop3Server: string,
        smtpServer: string,
        pop3Port: number = 110,
        smtpPort: number = 25
    ): void {
        const account = new EmailAccount();
        account.setEmailAddress(emailAddress);
        account.setUsername(username);
        account.setPassword(password);
        account.setPop3Server(pop3Server);
        account.setSmtpServer(smtpServer);
        account.setPop3Port(pop3Port);
        account.setSmtpPort(smtpPort);
        this.account = account;
        this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'email-client' });
    }

    /**
     * Send an email
     */
    async sendEmail(email: Email): Promise<SendResult> {
        const epoch = this.runtime.operations.epoch;
        if (!this.account) {
            return { success: false, message: 'No account configured' };
        }

        const smtpServer = this.account.getSmtpServer();
        const smtpPort = this.account.getSmtpPort();

        if (!smtpServer) {
            return { success: false, message: 'SMTP server not configured' };
        }

        // Set sender from account if not set or empty
        const existingFrom = email.getFrom();
        if (!existingFrom || !existingFrom.getMailAddress()) {
            email.setFrom(this.account.getEmailAddress());
        }

        // Get all recipient addresses
        const recipients = email.getAllRecipients().map(a => a.getMailAddress());

        if (recipients.length === 0) {
            return { success: false, message: 'No recipients specified' };
        }

        // Resolve SMTP server IP
        let serverIP = smtpServer;

        // Check if it's a hostname that needs resolution
        if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(smtpServer)) {
            // Try to resolve via host's DNS
            if (this.host.resolveHost) {
                const resolved = await this.host.resolveHost(smtpServer);
                if (resolved) {
                    serverIP = resolved;
                    this.log(`Resolved ${smtpServer} to ${serverIP}`);
                } else {
                    return { success: false, message: `Could not resolve SMTP server: ${smtpServer}` };
                }
            }
        }

        if (epoch !== this.runtime.operations.epoch) return { success: false, message: 'Simulation beendet' };
        // Send via SMTP
        const result = await this.smtpClient.sendEmail(
            serverIP,
            email,
            this.account.getEmailAddress(),
            recipients,
            smtpPort
        );

        if (epoch !== this.runtime.operations.epoch) return { success: false, message: 'Simulation beendet' };
        if (result.success) {
            // Add to sent folder
            const sentEmail = email.clone();
            sentEmail.setSent(true);
            sentEmail.setDateReceived(new Date().toISOString());
            this.sent.push(sentEmail);
            this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'email-client' });
        } else {
            this.lastError = result.message;
        }

        return result;
    }

    /**
     * Retrieve emails from server
     */
    async retrieveEmails(): Promise<POP3Result<Email[]>> {
        const epoch = this.runtime.operations.epoch;
        if (!this.account) {
            return { success: false, message: 'No account configured' };
        }

        const pop3Server = this.account.getPop3Server();
        const pop3Port = this.account.getPop3Port();
        const username = this.account.getUsername();
        const password = this.account.getPassword();

        if (!pop3Server) {
            return { success: false, message: 'POP3 server not configured' };
        }

        // Resolve POP3 server IP
        let serverIP = pop3Server;

        if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(pop3Server)) {
            if (this.host.resolveHost) {
                const resolved = await this.host.resolveHost(pop3Server);
                if (resolved) {
                    serverIP = resolved;
                    this.log(`Resolved ${pop3Server} to ${serverIP}`);
                } else {
                    return { success: false, message: `Could not resolve POP3 server: ${pop3Server}` };
                }
            }
        }

        if (epoch !== this.runtime.operations.epoch) return { success: false, message: 'Simulation beendet' };
        // Connect to POP3 server
        const connectResult = await this.pop3Client.connect(serverIP, username, password, pop3Port);
        if (epoch !== this.runtime.operations.epoch) return { success: false, message: 'Simulation beendet' };
        if (!connectResult.success) {
            this.lastError = connectResult.message;
            return { success: false, message: connectResult.message };
        }

        // Get message list
        const listResult = await this.pop3Client.listMessages();
        if (epoch !== this.runtime.operations.epoch) return { success: false, message: 'Simulation beendet' };
        if (!listResult.success || !listResult.data) {
            await this.pop3Client.disconnect();
            this.lastError = listResult.message;
            return { success: false, message: listResult.message };
        }

        const messages: MessageInfo[] = listResult.data;
        const retrievedEmails: Email[] = [];

        // Retrieve each message and delete from server
        for (const msgInfo of messages) {
            if (epoch !== this.runtime.operations.epoch) return { success: false, message: 'Simulation beendet' };
            const retrResult = await this.pop3Client.retrieveMessage(msgInfo.index);
            if (epoch !== this.runtime.operations.epoch) return { success: false, message: 'Simulation beendet' };
            if (retrResult.success && retrResult.data) {
                const email = retrResult.data as Email;
                retrievedEmails.push(email);
                this.inbox.push(email);

                // Mark for deletion on server (will be deleted on QUIT)
                await this.pop3Client.deleteMessage(msgInfo.index);
            }
        }

        // Disconnect (this sends QUIT which finalizes deletions)
        await this.pop3Client.disconnect();

        this.log(`Retrieved ${retrievedEmails.length} emails`);

        if (retrievedEmails.length > 0) {
            this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'email-client' });
        }

        return {
            success: true,
            message: `Retrieved ${retrievedEmails.length} emails`,
            data: retrievedEmails
        };
    }

    /**
     * Retrieve and delete emails from server (leave none on server)
     */
    async retrieveAndDeleteEmails(): Promise<POP3Result<Email[]>> {return this.retrieveEmails();}

    // ==================== Folder Access ====================

    getInbox(): Email[] {
        return [...this.inbox];
    }

    getSent(): Email[] {
        return [...this.sent];
    }

    getDrafts(): Email[] {
        return [...this.drafts];
    }

    getFolder(folder: EmailFolder): Email[] {
        switch (folder) {
            case 'inbox': return this.getInbox();
            case 'sent': return this.getSent();
            case 'drafts': return this.getDrafts();
        }
    }

    /**
     * Delete email from local folder
     */
    deleteEmail(folder: EmailFolder, index: number): boolean {
        const folderArray = folder === 'inbox' ? this.inbox :
            folder === 'sent' ? this.sent : this.drafts;

        if (index >= 0 && index < folderArray.length) {
            folderArray.splice(index, 1);
            this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'email-client' });
            return true;
        }
        return false;
    }

    /**
     * Save email to drafts
     */
    saveDraft(email: Email): void {
        this.drafts.push(email);
        this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'email-client' });
    }

    /**
     * Clear all emails in a folder
     */
    clearFolder(folder: EmailFolder): void {
        switch (folder) {
            case 'inbox': this.inbox = []; break;
            case 'sent': this.sent = []; break;
            case 'drafts': this.drafts = []; break;
        }
        this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'email-client' });
    }

    // ==================== Status ====================

    getStatus(): EmailClientStatus {
        return {
            connected: this.pop3Client.isConnected(),
            lastError: this.lastError,
            messageCount: this.inbox.length
        };
    }

    getLastError(): string | null {
        return this.lastError;
    }

    clearError(): void {
        this.lastError = null;
    }

    // ==================== Persistence ====================

    toJSON(): object {
        return {
            account: this.account?.toJSON() || null,
            inbox: this.inbox.map(e => e.toJSON()),
            sent: this.sent.map(e => e.toJSON()),
            drafts: this.drafts.map(e => e.toJSON())
        };
    }

    static fromJSON(json: any, host: Host): EmailClient {
        const client = new EmailClient(host);

        if (json.account) {
            client.account = EmailAccount.fromJSON(json.account);
        }

        if (json.inbox) {
            client.inbox = json.inbox.map((e: any) => Email.fromJSON(e));
        }

        if (json.sent) {
            client.sent = json.sent.map((e: any) => Email.fromJSON(e));
        }

        if (json.drafts) {
            client.drafts = json.drafts.map((e: any) => Email.fromJSON(e));
        }

        return client;
    }

    restoreFromJSON(json: any): void {
        if (json.account) {
            this.account = EmailAccount.fromJSON(json.account);
        }

        this.inbox = (json.inbox || []).map((e: any) => Email.fromJSON(e));
        this.sent = (json.sent || []).map((e: any) => Email.fromJSON(e));
        this.drafts = (json.drafts || []).map((e: any) => Email.fromJSON(e));
    }

    private log(message: string): void {
        if (this.logCallback) {
            this.logCallback(`[EmailClient] ${message}`);
        }
        console.log(`[EmailClient] ${message}`);
    }
}

/**
 * Host-level email client manager
 */
export class HostEmailClientManager {
    constructor(private owner?: RuntimeDependencies) {}

    private clients: Map<string, EmailClient> = new Map();

    getOrCreateClient(host: Host): EmailClient {
        assertRuntimeOwner(host, this.owner);
        const hostId = host.getId();
        let client = this.clients.get(hostId);
        if (!client) {
            client = new EmailClient(host);
            this.clients.set(hostId, client);
        }
        return client;
    }

    getClient(hostId: string): EmailClient | null {
        return this.clients.get(hostId) || null;
    }

    removeClient(hostId: string): void {
        this.clients.delete(hostId);
    }

    /**
     * Get persistence state
     */
    getServiceState(): { hostId: string; clientState: object }[] {
        const state: { hostId: string; clientState: object }[] = [];
        this.clients.forEach((client, hostId) => {
            state.push({
                hostId,
                clientState: client.toJSON()
            });
        });
        return state;
    }

    /**
     * Restore persistence state
     */
    restoreServiceState(
        state: { hostId: string; clientState: any }[],
        hosts: Host[]
    ): void {
        hosts?.forEach(host => assertRuntimeOwner(host, this.owner));
        this.clients.clear();

        for (const item of state) {
            const host = hosts.find(h => h.getId() === item.hostId);
            if (host) {
                const client = EmailClient.fromJSON(item.clientState, host);
                this.clients.set(item.hostId, client);
            }
        }

        console.log(`[HostEmailClientManager] Restored ${this.clients.size} email clients`);
    }

    clear(): void {
        this.clients.clear();
    }
}

export const hostEmailClientManager = new HostEmailClientManager();
