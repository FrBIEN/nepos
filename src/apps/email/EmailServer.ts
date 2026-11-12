import { assertRuntimeOwner } from '../../runtime/assertRuntimeOwner';
import type { RuntimeDependencies } from '../../runtime/RuntimeDependencies';
import { legacyRuntime } from '../../runtime/LegacyRuntime';
// EmailServer - Combined SMTP/POP3 server with account management

import { Host } from '../../hardware/Host';
import { SMTPServer, EmailDeliveryHandler, SMTP_PORT } from './SMTPServer';
import { POP3Server, AccountHandler } from './POP3Server';
import { SMTPClient } from './SMTPClient';
import { Email, EmailAccount } from './Email';
import { eventBus, Events } from '../../core/EventBus';

import { DNSClient, DNSRecordType } from '../DNS';

/**
 * Observer callback for UI updates
 */
export type EmailServerObserver = (message: string) => void;

/**
 * EmailServer - Manages email accounts and coordinates SMTP/POP3 servers
 * Matches original Filius EmailServer.java functionality
 */
export class EmailServer implements EmailDeliveryHandler, AccountHandler {
    private get runtime() { return this.host?.runtime ?? legacyRuntime; }

    private host: Host;
    private mailDomain: string = 'filius.de';
    private accounts: Map<string, EmailAccount> = new Map();
    private smtpServer: SMTPServer;
    private pop3Server: POP3Server;
    private running: boolean = false;
    private observers: Set<EmailServerObserver> = new Set();

    constructor(host: Host) {
        this.host = host;
        this.smtpServer = new SMTPServer(host, this);
        this.pop3Server = new POP3Server(host, this);
    }

    // ==================== Server Lifecycle ====================

    start(): boolean {
        if (this.running) return false;

        const smtpStarted = this.smtpServer.start();
        const pop3Started = this.pop3Server.start();

        if (smtpStarted && pop3Started) {
            this.running = true;
            this.notifyObservers('Email server started');
            console.log(`[EmailServer] Started on ${this.host.getIP()} domain=${this.mailDomain}`);
            return true;
        } else {
            // Rollback if partial start
            if (smtpStarted) this.smtpServer.stop();
            if (pop3Started) this.pop3Server.stop();
            return false;
        }
    }

    stop(): void {
        this.smtpServer.stop();
        this.pop3Server.stop();
        this.running = false;
        this.notifyObservers('Email server stopped');
        console.log('[EmailServer] Stopped');
    }

    isRunning(): boolean {
        return this.running;
    }

    // ==================== Domain Configuration ====================

    getMailDomain(): string {
        return this.mailDomain;
    }

    setMailDomain(domain: string): void {
        // Basic validation
        if (domain && /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/.test(domain)) {
            const oldDomain = this.mailDomain;
            this.mailDomain = domain;

            // Update existing accounts' email addresses to new domain
            if (oldDomain !== domain) {
                this.accounts.forEach((account) => {
                    const username = account.getUsername();
                    account.setEmailAddress(`${username}@${domain}`);
                });
                console.log(`[EmailServer] Domain changed from ${oldDomain} to ${domain}, updated ${this.accounts.size} accounts`);

                // Trigger autosave
                this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'email-server' });
            }
        }
    }

    getHost(): Host {
        return this.host;
    }

    // ==================== Account Management ====================

    /**
     * Add a new user account
     */
    addAccount(username: string, password: string, firstName?: string, lastName?: string): boolean {
        const lowerUsername = username.toLowerCase();

        // Check if account already exists
        if (this.accounts.has(lowerUsername)) {
            this.notifyObservers(`Account creation failed: ${username} already exists`);
            return false;
        }

        const account = new EmailAccount();
        account.setUsername(lowerUsername);
        account.setPassword(password);
        account.setFirstName(firstName || '');
        account.setLastName(lastName || '');
        account.setEmailAddress(`${lowerUsername}@${this.mailDomain}`);

        this.accounts.set(lowerUsername, account);
        this.notifyObservers(`Account created: ${username}`);
        return true;
    }

    /**
     * Remove a user account
     */
    removeAccount(username: string, password: string): boolean {
        const lowerUsername = username.toLowerCase();
        const account = this.accounts.get(lowerUsername);

        if (!account) {
            return false;
        }

        if (account.getPassword() !== password) {
            return false;
        }

        this.accounts.delete(lowerUsername);
        this.notifyObservers(`Account deleted: ${username}`);
        return true;
    }

    /**
     * Get all accounts (for UI display)
     */
    getAccounts(): EmailAccount[] {
        return Array.from(this.accounts.values());
    }

    /**
     * Get account count
     */
    getAccountCount(): number {
        return this.accounts.size;
    }

    // ==================== AccountHandler Interface (for POP3) ====================

    findAccount(username: string): EmailAccount | null {
        return this.accounts.get(username.toLowerCase()) || null;
    }

    validateCredentials(username: string, password: string): EmailAccount | null {
        const account = this.findAccount(username);
        if (account && account.getPassword() === password) {
            return account;
        }
        return null;
    }

    saveAccounts(): void {
        // Persistence is handled by the manager
        this.notifyObservers('Accounts saved');
    }

    // ==================== EmailDeliveryHandler Interface (for SMTP) ====================

    hasRecipient(recipient: string): boolean { return !!this.findAccount(recipient.split('@')[0]); }
    isLocalDomain(recipient: string): boolean {
        const parts = recipient.split('@');
        if (parts.length !== 2) return false;
        return parts[1].toLowerCase() === this.mailDomain.toLowerCase();
    }

    deliverLocal(email: Email, recipient: string): boolean {
        const parts = recipient.split('@');
        if (parts.length !== 2) return false;

        const username = parts[0].toLowerCase();
        const account = this.accounts.get(username);

        if (!account) {
            this.notifyObservers(`Delivery failed: unknown user ${username}`);
            return false;
        }

        // Clone the email and add to account
        const deliveredEmail = email.clone();
        deliveredEmail.setDateReceived(new Date().toISOString());
        account.addMessage(deliveredEmail);

        this.notifyObservers(`Email delivered to ${username}`);
        return true;
    }

    forwardEmail(email: Email, sender: string, recipients: string[]): void {
        console.log('[EmailServer] forwardEmail called:', { sender, recipients, emailSubject: email.getSubject() });

        // Group recipients by domain
        const byDomain = new Map<string, string[]>();

        for (const rcpt of recipients) {
            const parts = rcpt.split('@');
            if (parts.length === 2) {
                const domain = parts[1].toLowerCase();
                if (!byDomain.has(domain)) {
                    byDomain.set(domain, []);
                }
                byDomain.get(domain)!.push(rcpt);
            }
        }

        console.log('[EmailServer] Grouped recipients by domain:', Object.fromEntries(byDomain));

        // Forward to each domain
        for (const [domain, domainRecipients] of byDomain) {
            this.notifyObservers(`Forwarding email to ${domain}: ${domainRecipients.join(', ')}`);

            const eventData = {
                email: email.toJSON(),
                sender,
                recipients: domainRecipients,
                domain,
                sourceHost: this.host.getId()
            };

            console.log('[EmailServer] Emitting email:forward event:', { domain, sourceHost: this.host.getId() });
            this.runtime.events.emit('email:forward', eventData);
        }
    }

    sendBounce(originalEmail: Email, sender: string, failedRecipients: string[], reason: string): void {
        // Delivery-status notifications must not generate another bounce.
        if (!sender.includes('@') || sender.toLowerCase().startsWith('mailer-daemon@')) return;
        console.log(`[EmailServer] Generating bounce message for ${sender}`);

        // Create the bounce email
        const bounceEmail = new Email();
        bounceEmail.setFrom(`mailer-daemon@${this.mailDomain}`);
        bounceEmail.addTo(sender);
        bounceEmail.setSubject(`Undeliverable: ${originalEmail.getSubject() || '(no subject)'}`);
        bounceEmail.setDateReceived(new Date().toISOString());
        bounceEmail.setIsNew(true);

        const bounceBody = `
This is an automatically generated Delivery Status Notification.

Delivery to the following recipient(s) failed:

${failedRecipients.map(r => `    ${r}`).join('\n')}

Error: ${reason}

----- Original Message -----
From: ${originalEmail.getFrom()?.getMailAddress() || 'unknown'}
To: ${originalEmail.getTo().map(a => a.getMailAddress()).join(', ')}
Subject: ${originalEmail.getSubject() || '(no subject)'}
Date: ${originalEmail.getDateReceived() || 'unknown'}

${originalEmail.getBody().substring(0, 500)}${originalEmail.getBody().length > 500 ? '...' : ''}
`;
        bounceEmail.setBody(bounceBody.trim());

        // Check if sender is local
        if (this.isLocalDomain(sender)) {
            // Deliver directly to local mailbox
            const delivered = this.deliverLocal(bounceEmail, sender);
            if (delivered) {
                console.log(`[EmailServer] Bounce message delivered locally to ${sender}`);
            } else {
                console.error(`[EmailServer] Failed to deliver local bounce to ${sender}`);
            }
        } else {
            // Forward to remote domain (simulates full network path)
            console.log(`[EmailServer] Forwarding bounce message to remote sender ${sender}`);
            this.forwardEmail(bounceEmail, `mailer-daemon@${this.mailDomain}`, [sender]);
        }
    }

    // ==================== Logging ====================

    log(message: string): void {
        this.notifyObservers(message);
    }

    // ==================== Observer Pattern ====================

    addObserver(observer: EmailServerObserver): void {
        this.observers.add(observer);
    }

    removeObserver(observer: EmailServerObserver): void {
        this.observers.delete(observer);
    }

    private notifyObservers(message: string): void {
        const timestamp = new Date().toLocaleTimeString();
        const formatted = `[${timestamp}] ${message}`;
        this.observers.forEach(obs => obs(formatted));
    }

    // ==================== Persistence ====================

    toJSON(): object {
        return {
            mailDomain: this.mailDomain,
            accounts: Array.from(this.accounts.entries()).map(([key, acc]) => ({
                key,
                account: acc.toJSON()
            })),
            running: this.running
        };
    }

    static fromJSON(json: any, host: Host): EmailServer {
        const server = new EmailServer(host);
        server.mailDomain = json.mailDomain || 'filius.de';

        if (json.accounts) {
            for (const entry of json.accounts) {
                const account = EmailAccount.fromJSON(entry.account);
                server.accounts.set(entry.key, account);
            }
        }

        return server;
    }

    restoreFromJSON(json: any): void {
        this.mailDomain = json.mailDomain || 'filius.de';
        this.accounts.clear();

        if (json.accounts) {
            for (const entry of json.accounts) {
                const account = EmailAccount.fromJSON(entry.account);
                this.accounts.set(entry.key, account);
            }
        }
    }
}

/**
 * HostEmailServerManager - Global manager for email servers per host
 * Follows pattern of hostDnsServerManager, hostServerManager
 */
export class HostEmailServerManager {
    private get runtime() { return this.owner ?? legacyRuntime; }

    private servers: Map<string, EmailServer> = new Map();
    private previouslyRunning: Set<string> = new Set();

    private forwardSubscription: {unsubscribe: () => void};
    constructor(private owner?: RuntimeDependencies) {
        // A project owns its forwarding observer. The compatibility instance uses the legacy bus.
        this.forwardSubscription = (owner?.events ?? eventBus).on('email:forward', this.handleEmailForward.bind(this));
    }

    dispose(): void { this.stopAll(); this.forwardSubscription.unsubscribe(); }

    /**
     * Handle forwarding email to remote server
     */
    private async handleEmailForward(data: {
        email: any;
        sender: string;
        recipients: string[];
        domain: string;
        sourceHost: string;
    }): Promise<void> {
        const epoch = this.runtime.operations.epoch;
        console.log('[HostEmailServerManager] Received email:forward event:', data);

        // Find the source host - first try from our servers map, then fallback to networkStack
        let sourceHost: Host | undefined;

        // Check if the source host has an email server registered with us
        const sourceServer = this.servers.get(data.sourceHost);
        if (sourceServer) {
            sourceHost = sourceServer.getHost();
            console.log('[HostEmailServerManager] Found source host from servers map:', sourceHost?.getName());
        }

        // Fallback to networkStack lookup
        if (!sourceHost) {
            sourceHost = this.runtime.network.findHostById(data.sourceHost);
            console.log('[HostEmailServerManager] Found source host from networkStack:', sourceHost?.getName());
        }

        if (!sourceHost) {
            console.error('[HostEmailServerManager] Source host not found:', data.sourceHost);
            console.log('[HostEmailServerManager] Available servers:', Array.from(this.servers.keys()));
            return;
        }

        // Reconstruct the Email object from JSON
        const email = Email.fromJSON(data.email);

        let targetServerIP: string | null = null;
        const dnsServer = sourceHost.getNetworkInterface().getDNS();
        if (dnsServer) {
            const dnsClient = new DNSClient(dnsServer, sourceHost);
            try {

                // Step 1: Query MX record
                console.log(`[HostEmailServerManager] Querying MX record for ${data.domain}`);
                const mxRecords = await dnsClient.resolve(data.domain, DNSRecordType.MX).catch(() => []);

                if (epoch !== this.runtime.operations.epoch) return;
                if (mxRecords && mxRecords.length > 0) {
                    // MX record value should be the mail server hostname
                    const mxHostname = mxRecords[0].value.trim().split(/\s+/).at(-1)!;
                    console.log(`[HostEmailServerManager] MX record found: ${mxHostname}`);

                    // Step 2: Query A record for the MX hostname
                    // Check if MX value is already an IP
                    const ipRegex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
                    if (ipRegex.test(mxHostname)) {
                        targetServerIP = mxHostname;
                        console.log(`[HostEmailServerManager] MX value is IP: ${targetServerIP}`);
                    } else {
                        console.log(`[HostEmailServerManager] Querying A record for ${mxHostname}`);
                        const aRecords = await dnsClient.resolve(mxHostname, DNSRecordType.A);
                        if (aRecords && aRecords.length > 0) {
                            targetServerIP = aRecords[0].value;
                            console.log(`[HostEmailServerManager] A record found: ${targetServerIP}`);
                        }
                    }
                } else {
                    // Fallback: try A record directly (some setups use A record only)
                    console.log(`[HostEmailServerManager] No MX record, trying A record for ${data.domain}`);
                    const aRecords = await dnsClient.resolve(data.domain, DNSRecordType.A);
                    if (aRecords && aRecords.length > 0) {
                        targetServerIP = aRecords[0].value;
                        console.log(`[HostEmailServerManager] A record found: ${targetServerIP}`);
                    }
                }

            } catch (e) {
                console.error(`[HostEmailServerManager] DNS lookup failed for ${data.domain}:`, e);
            } finally { dnsClient.close(); }
        }

        if (epoch !== this.runtime.operations.epoch) return;
        if (!targetServerIP) {
            console.error(`[HostEmailServerManager] Could not find server for domain ${data.domain}`);
            // Send bounce message back to sender
            this.servers.get(data.sourceHost)?.sendBounce(
                email,
                data.sender,
                data.recipients,
                `Delivery failed: Domain ${data.domain} not found (no MX/A record or server unreachable)`
            );
            return;
        }

        // Create SMTP client and forward the email
        console.log(`[HostEmailServerManager] Creating SMTP client to forward email from ${sourceHost.getName()} to ${targetServerIP}`);
        const smtpClient = new SMTPClient(sourceHost);
        smtpClient.setLogCallback((msg) => console.log(`[EmailForward] ${msg}`));

        try {
            const result = await smtpClient.sendEmail(
                targetServerIP,
                email,
                data.sender,
                data.recipients,
                SMTP_PORT
            );

            if (epoch !== this.runtime.operations.epoch) return;
            if (result.success) {
                console.log(`[HostEmailServerManager] Successfully forwarded email to ${data.domain}`);
            } else {
                console.error(`[HostEmailServerManager] Failed to forward email: ${result.message}`);
                // Send bounce message back to sender
                this.servers.get(data.sourceHost)?.sendBounce(
                    email,
                    data.sender,
                    data.recipients,
                    `Delivery failed: ${result.message}`
                );
            }
        } catch (e) {
            if (epoch !== this.runtime.operations.epoch) return;
            console.error('[HostEmailServerManager] Error forwarding email:', e);
            // Send bounce message back to sender
            this.servers.get(data.sourceHost)?.sendBounce(
                email,
                data.sender,
                data.recipients,
                `Delivery failed: Server ${targetServerIP} unreachable`
            );
        }
    }

    getOrCreateServer(host: Host): EmailServer {
        assertRuntimeOwner(host, this.owner);
        const hostId = host.getId();
        let server = this.servers.get(hostId);
        if (!server) {
            server = new EmailServer(host);
            this.servers.set(hostId, server);
        }
        return server;
    }

    getServer(hostId: string): EmailServer | null {
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
     * Restart servers when entering simulation mode
     */
    restartServers(): void {
        console.log(`[HostEmailServerManager] Restarting ${this.servers.size} email servers`);
        this.servers.forEach((server, hostId) => {
            if (server.isRunning()) {
                console.log(`[HostEmailServerManager] Force restarting server on ${hostId}`);
                server.stop();
                server.start();
            } else if (this.previouslyRunning.has(hostId)) {
                server.start();
            }
        });

        this.previouslyRunning.clear();
    }

    /**
     * Stop all servers when leaving simulation mode
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
     * Get persistence state
     */
    getServiceState(): { hostId: string; serverState: object; running: boolean }[] {
        const state: { hostId: string; serverState: object; running: boolean }[] = [];
        this.servers.forEach((server, hostId) => {
            state.push({
                hostId,
                serverState: server.toJSON(),
                running: server.isRunning() || this.previouslyRunning.has(hostId)
            });
        });
        return state;
    }

    /**
     * Restore persistence state
     */
    restoreServiceState(
        state: { hostId: string; serverState: any; running: boolean }[],
        hosts: Host[]
    ): void {
        hosts?.forEach(host => assertRuntimeOwner(host, this.owner));
        this.servers.forEach(server => server.stop());
        this.servers.clear();
        this.previouslyRunning.clear();

        for (const item of state) {
            const host = hosts.find(h => h.getId() === item.hostId);
            if (host) {
                const server = EmailServer.fromJSON(item.serverState, host);
                this.servers.set(item.hostId, server);
                if (item.running) {
                    this.previouslyRunning.add(item.hostId);
                }
            }
        }

        console.log(`[HostEmailServerManager] Restored ${this.servers.size} email servers`);
    }

    clear(): void {
        this.servers.forEach(server => server.stop());
        this.servers.clear();
        this.previouslyRunning.clear();
    }
}

export const hostEmailServerManager = new HostEmailServerManager();

