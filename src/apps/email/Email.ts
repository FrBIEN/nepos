// Email - Core data models for email system

/**
 * AddressEntry - Represents an email address with optional display name
 * Format: "Display Name <email@domain.de>" or just "<email@domain.de>" or "email@domain.de"
 */
export class AddressEntry {
    private displayName: string = '';
    private mailAddress: string = '';

    constructor(addressString?: string | AddressEntry) {
        if (!addressString) return;

        if (addressString instanceof AddressEntry) {
            this.displayName = addressString.displayName;
            this.mailAddress = addressString.mailAddress;
            return;
        }

        // Parse address string
        // Formats: "Name <email@domain>" or "<email@domain>" or "email@domain"
        const str = addressString.trim();
        const angleStart = str.indexOf('<');
        const angleEnd = str.indexOf('>');

        if (angleStart >= 0 && angleEnd > angleStart) {
            this.displayName = str.substring(0, angleStart).trim();
            this.mailAddress = str.substring(angleStart + 1, angleEnd).trim();
        } else {
            // Plain email address
            this.mailAddress = str;
        }
    }

    getDisplayName(): string {
        return this.displayName;
    }

    setDisplayName(name: string): void {
        this.displayName = name;
    }

    getMailAddress(): string {
        return this.mailAddress;
    }

    setMailAddress(address: string): void {
        this.mailAddress = address;
    }

    /**
     * Get the local part (username) of the email address
     */
    getLocalPart(): string {
        const parts = this.mailAddress.split('@');
        return parts[0] || '';
    }

    /**
     * Get the domain part of the email address
     */
    getDomain(): string {
        const parts = this.mailAddress.split('@');
        return parts[1] || '';
    }

    toString(): string {
        if (this.displayName) {
            return `${this.displayName} <${this.mailAddress}>`;
        }
        return `<${this.mailAddress}>`;
    }

    toJSON(): { displayName: string; mailAddress: string } {
        return {
            displayName: this.displayName,
            mailAddress: this.mailAddress
        };
    }

    static fromJSON(json: { displayName?: string; mailAddress?: string }): AddressEntry {
        const entry = new AddressEntry();
        entry.displayName = json.displayName || '';
        entry.mailAddress = json.mailAddress || '';
        return entry;
    }
}

/**
 * Email - Represents an email message
 * Matches original Filius Email.java structure
 */
export class Email {
    private uid = crypto.randomUUID();
    getUID(): string { return this.uid; }
    private from: AddressEntry | null = null;
    private to: AddressEntry[] = [];
    private cc: AddressEntry[] = [];
    private bcc: AddressEntry[] = [];
    private subject: string = '';
    private body: string = '';
    private dateReceived: string = '';

    // Flags
    private isNew: boolean = true;       // Not yet retrieved by client
    private markedForDelete: boolean = false;
    private sent: boolean = false;       // Has been sent (for outbox)

    constructor(rawMessage?: string) {
        if (rawMessage) {
            this.parseMessage(rawMessage);
        }
    }

    /**
     * Parse RFC 822-like message format
     * Format:
     * From: <sender@domain>
     * To: <recipient@domain>
     * Cc: <cc@domain>
     * Subject: Subject line
     *
     * Body text here
     */
    private parseMessage(message: string): void {
        const lines = message.split('\n');
        let inBody = false;
        const bodyLines: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (inBody) {
                bodyLines.push(line);
                continue;
            }

            // Empty line marks start of body section (after headers)
            if (line.trim() === '') {
                inBody = true;
                continue;
            }

            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const fieldName = line.substring(0, colonIndex).trim().toLowerCase();
                const fieldData = line.substring(colonIndex + 1).trim();

                switch (fieldName) {
                    case 'from':
                        this.from = new AddressEntry(fieldData);
                        break;
                    case 'to':
                        this.to = this.parseAddressList(fieldData);
                        break;
                    case 'cc':
                        this.cc = this.parseAddressList(fieldData);
                        break;
                    case 'bcc':
                        this.bcc = this.parseAddressList(fieldData);
                        break;
                    case 'subject':
                        this.subject = fieldData;
                        break;
                    case 'date received':
                        this.dateReceived = fieldData;
                        break;
                    default:
                        // Unknown header - treat as start of body if it doesn't look like a header
                        // (headers typically have short field names)
                        if (fieldName.length > 20 || !fieldName.match(/^[a-z-]+$/)) {
                            inBody = true;
                            bodyLines.push(line);
                        }
                    // Otherwise it's an unknown header we skip
                }
            } else {
                // No colon in line - this is body content that started without an empty line separator
                inBody = true;
                bodyLines.push(line);
            }
        }

        this.body = bodyLines.join('\n').trim();
    }

    private parseAddressList(data: string): AddressEntry[] {
        const result: AddressEntry[] = [];
        const parts = data.split(',');
        for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed) {
                result.push(new AddressEntry(trimmed));
            }
        }
        return result;
    }

    /**
     * Serialize to RFC 822-like format (without BCC for transmission)
     * Always includes From and To headers when set (even if address might be empty)
     * as the message headers need to be preserved through SMTP/POP3 transfer.
     */
    toString(): string {
        let result = '';

        // Always include From header if set - the SMTP envelope handles actual routing
        if (this.from) {
            result += `From: ${this.from.toString()}\n`;
        }

        // Always include To header if recipients exist
        if (this.to.length > 0) {
            result += `To: ${this.to.map(a => a.toString()).join(', ')}\n`;
        }

        if (this.cc.length > 0) {
            result += `Cc: ${this.cc.map(a => a.toString()).join(', ')}\n`;
        }

        // Note: BCC is intentionally NOT included in toString() per RFC

        if (this.subject) {
            result += `Subject: ${this.subject.trim()}\n`;
        }

        if (this.dateReceived) {
            result += `Date Received: ${this.dateReceived}\n`;
        }

        result += '\n';
        result += this.body.trim();

        return result;
    }

    /**
     * Get all recipients (To + Cc + Bcc) for delivery
     */
    getAllRecipients(): AddressEntry[] {
        return [...this.to, ...this.cc, ...this.bcc];
    }

    /**
     * Get recipient list as comma-separated string
     */
    getRecipientList(): string {
        return this.to.map(a => a.toString()).join(', ');
    }

    // Getters and setters
    getFrom(): AddressEntry | null {
        return this.from ? new AddressEntry(this.from) : null;
    }

    setFrom(from: string | AddressEntry): void {
        this.from = from instanceof AddressEntry ? from : new AddressEntry(from);
    }

    getTo(): AddressEntry[] {
        return this.to;
    }

    setTo(to: AddressEntry[]): void {
        this.to = to;
    }

    addTo(address: string | AddressEntry): void {
        this.to.push(address instanceof AddressEntry ? address : new AddressEntry(address));
    }

    getCc(): AddressEntry[] {
        return this.cc;
    }

    setCc(cc: AddressEntry[]): void {
        this.cc = cc;
    }

    getBcc(): AddressEntry[] {
        return this.bcc;
    }

    setBcc(bcc: AddressEntry[]): void {
        this.bcc = bcc;
    }

    getSubject(): string {
        return this.subject;
    }

    setSubject(subject: string): void {
        this.subject = subject;
    }

    getBody(): string {
        return this.body;
    }

    setBody(body: string): void {
        this.body = body;
    }

    getDateReceived(): string {
        return this.dateReceived;
    }

    setDateReceived(date: string): void {
        this.dateReceived = date;
    }

    getIsNew(): boolean {
        return this.isNew;
    }

    setIsNew(isNew: boolean): void {
        this.isNew = isNew;
    }

    isMarkedForDelete(): boolean {
        return this.markedForDelete;
    }

    setMarkedForDelete(marked: boolean): void {
        this.markedForDelete = marked;
    }

    isSent(): boolean {
        return this.sent;
    }

    setSent(sent: boolean): void {
        this.sent = sent;
    }

    /**
     * Calculate approximate size in bytes (for POP3 LIST/STAT)
     */
    getSize(): number {
        return new TextEncoder().encode(this.toString().replace(/\r?\n/g,'\r\n')).length;
    }

    /**
     * Clone this email by copying all fields directly
     */
    clone(): Email {
        const cloned = new Email();
        if (this.from) {
            cloned.from = new AddressEntry(this.from);
        }
        cloned.to = this.to.map(a => new AddressEntry(a));
        cloned.cc = this.cc.map(a => new AddressEntry(a));
        cloned.bcc = this.bcc.map(a => new AddressEntry(a));
        cloned.uid = this.uid;
        cloned.subject = this.subject;
        cloned.body = this.body;
        cloned.dateReceived = this.dateReceived;
        cloned.isNew = this.isNew;
        cloned.markedForDelete = this.markedForDelete;
        cloned.sent = this.sent;
        return cloned;
    }

    toJSON(): object {
        return {
            uid: this.uid,
            from: this.from?.toJSON() || null,
            to: this.to.map(a => a.toJSON()),
            cc: this.cc.map(a => a.toJSON()),
            bcc: this.bcc.map(a => a.toJSON()),
            subject: this.subject,
            body: this.body,
            dateReceived: this.dateReceived,
            isNew: this.isNew,
            markedForDelete: this.markedForDelete,
            sent: this.sent
        };
    }

    static fromJSON(json: any): Email {
        const email = new Email();
        if (typeof json.uid === 'string') email.uid = json.uid;
        if (json.from) email.from = AddressEntry.fromJSON(json.from);
        if (json.to) email.to = json.to.map((a: any) => AddressEntry.fromJSON(a));
        if (json.cc) email.cc = json.cc.map((a: any) => AddressEntry.fromJSON(a));
        if (json.bcc) email.bcc = json.bcc.map((a: any) => AddressEntry.fromJSON(a));
        email.subject = json.subject || '';
        email.body = json.body || '';
        email.dateReceived = json.dateReceived || '';
        email.isNew = json.isNew ?? true;
        email.markedForDelete = false; // POP3 deletion marks belong to a live transaction.
        email.sent = json.sent ?? false;
        return email;
    }
}

/**
 * EmailAccount - User account on an email server
 * Matches original Filius EmailKonto.java
 */
export class EmailAccount {
    private username: string = '';
    private password: string = '';
    private firstName: string = '';
    private lastName: string = '';
    private emailAddress: string = '';
    private messages: Email[] = [];

    // Client-side account settings (used by EmailClient)
    private pop3Server: string = '';
    private pop3Port: number = 110;
    private smtpServer: string = '';
    private smtpPort: number = 25;

    constructor(accountString?: string) {
        if (accountString) {
            // Parse semicolon-separated format from original Filius
            const parts = accountString.split(';');
            if (parts.length >= 9) {
                this.pop3Server = parts[0];
                this.smtpServer = parts[1];
                this.pop3Port = parseInt(parts[2]) || 110;
                this.smtpPort = parseInt(parts[3]) || 25;
                this.username = parts[4];
                this.password = parts[5];
                this.lastName = parts[6];
                this.firstName = parts[7];
                this.emailAddress = parts[8];
            }
        }
    }

    // Getters and setters
    getUsername(): string {
        return this.username;
    }

    setUsername(username: string): void {
        this.username = username;
    }

    getPassword(): string {
        return this.password;
    }

    setPassword(password: string): void {
        this.password = password;
    }

    getFirstName(): string {
        return this.firstName;
    }

    setFirstName(firstName: string): void {
        this.firstName = firstName || '';
    }

    getLastName(): string {
        return this.lastName;
    }

    setLastName(lastName: string): void {
        this.lastName = lastName || '';
    }

    getFullName(): string {
        return `${this.firstName} ${this.lastName}`.trim();
    }

    getEmailAddress(): string {
        return this.emailAddress;
    }

    setEmailAddress(email: string): void {
        this.emailAddress = email;
    }

    getMessages(): Email[] {
        return this.messages;
    }

    setMessages(messages: Email[]): void {
        this.messages = messages;
    }

    addMessage(email: Email): void {
        this.messages.push(email);
    }

    removeMessage(index: number): Email | undefined {
        if (index >= 0 && index < this.messages.length) {
            return this.messages.splice(index, 1)[0];
        }
        return undefined;
    }

    /**
     * Get number of messages not marked for delete
     */
    getMessageCount(): number {
        return this.messages.filter(m => !m.isMarkedForDelete()).length;
    }

    /**
     * Get total size of messages not marked for delete
     */
    getTotalSize(): number {
        return this.messages
            .filter(m => !m.isMarkedForDelete())
            .reduce((sum, m) => sum + m.getSize(), 0);
    }

    /**
     * Apply deletions (called on POP3 QUIT)
     */
    applyDeletions(): void {
        this.messages = this.messages.filter(m => !m.isMarkedForDelete());
    }

    /**
     * Reset all deletion marks (called on POP3 RSET)
     */
    resetDeletions(): void {
        this.messages.forEach(m => m.setMarkedForDelete(false));
    }

    // Server configuration (for client use)
    getPop3Server(): string {
        return this.pop3Server;
    }

    setPop3Server(server: string): void {
        this.pop3Server = server;
    }

    getPop3Port(): number {
        return this.pop3Port;
    }

    setPop3Port(port: number): void {
        this.pop3Port = port;
    }

    getSmtpServer(): string {
        return this.smtpServer;
    }

    setSmtpServer(server: string): void {
        this.smtpServer = server;
    }

    getSmtpPort(): number {
        return this.smtpPort;
    }

    setSmtpPort(port: number): void {
        this.smtpPort = port;
    }

    toString(): string {
        return `${this.pop3Server};${this.smtpServer};${this.pop3Port};${this.smtpPort};` +
            `${this.username};${this.password};${this.lastName};${this.firstName};${this.emailAddress}`;
    }

    toJSON(): object {
        return {
            username: this.username,
            password: this.password,
            firstName: this.firstName,
            lastName: this.lastName,
            emailAddress: this.emailAddress,
            messages: this.messages.map(m => m.toJSON()),
            pop3Server: this.pop3Server,
            pop3Port: this.pop3Port,
            smtpServer: this.smtpServer,
            smtpPort: this.smtpPort
        };
    }

    static fromJSON(json: any): EmailAccount {
        const account = new EmailAccount();
        account.username = json.username || '';
        account.password = json.password || '';
        account.firstName = json.firstName || '';
        account.lastName = json.lastName || '';
        account.emailAddress = json.emailAddress || '';
        account.messages = (json.messages || []).map((m: any) => Email.fromJSON(m));
        account.pop3Server = json.pop3Server || '';
        account.pop3Port = json.pop3Port || 110;
        account.smtpServer = json.smtpServer || '';
        account.smtpPort = json.smtpPort || 25;
        return account;
    }
}

/**
 * Standard SMTP response codes
 */
export const SMTPResponse = {
    READY: '220',
    CLOSING: '221',
    OK: '250',
    START_DATA: '354',
    SERVICE_UNAVAILABLE: '421',
    MAILBOX_UNAVAILABLE: '450',
    LOCAL_ERROR: '451',
    INSUFFICIENT_STORAGE: '452',
    SYNTAX_ERROR: '500',
    SYNTAX_ERROR_PARAMS: '501',
    NOT_IMPLEMENTED: '502',
    BAD_SEQUENCE: '503',
    MAILBOX_NOT_FOUND: '550',
    USER_NOT_LOCAL: '551',
    EXCEEDED_STORAGE: '552',
    MAILBOX_NAME_INVALID: '553',
    TRANSACTION_FAILED: '554'
} as const;

/**
 * Standard POP3 response prefixes
 */
export const POP3Response = {
    OK: '+OK',
    ERR: '-ERR'
} as const;
