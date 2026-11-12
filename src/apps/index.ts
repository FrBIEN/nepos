// Apps module index

export { DNSServer, DNSClient, DNSRecordType, DNSResponseCode, hostDnsServerManager, type DNSRecord, type DNSQuery, type DNSResponse } from './DNS';
export { DHCPServer, DHCPClient, DHCPMessageType, hostDhcpServerManager, type DHCPMessage, type DHCPLease, type DHCPPoolConfig } from './DHCP';
export { Terminal, type TerminalCommand, type PingResult } from './Terminal';
export { WebServer, WebBrowser, hostServerManager, type HTTPRequest, type HTTPResponse, type WebFile, type AccessLogEntry } from './WebServer';
export { EchoServer, HostEchoServerManager, hostEchoServerManager } from './EchoServer';
export { SimpleClient } from './SimpleClient';
export { FileSystem, HostFileSystemManager, hostFileSystemManager, type FileSystemNode, type FileSystemStats } from './FileSystem';

// Email module
export {
    Email,
    EmailAccount,
    AddressEntry,
    SMTPServer,
    POP3Server,
    EmailServer,
    SMTPClient,
    POP3Client,
    EmailClient,
    hostEmailServerManager,
    hostEmailClientManager,
    SMTP_PORT,
    POP3_PORT,
    type EmailDeliveryHandler,
    type AccountHandler,
    type EmailServerObserver,
    type SendResult,
    type MailboxStats,
    type MessageInfo,
    type POP3Result,
    type EmailFolder,
    type EmailClientStatus
} from './email';
