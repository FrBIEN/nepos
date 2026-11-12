// Email module - exports all email-related components

// Core data models
export {
    Email,
    EmailAccount,
    AddressEntry,
    SMTPResponse,
    POP3Response
} from './Email';

// SMTP Server
export {
    SMTPServer,
    SMTP_PORT,
    type EmailDeliveryHandler
} from './SMTPServer';

// POP3 Server
export {
    POP3Server,
    POP3_PORT,
    type AccountHandler
} from './POP3Server';

// Combined Email Server
export {
    EmailServer,
    HostEmailServerManager,
    hostEmailServerManager,
    type EmailServerObserver
} from './EmailServer';

// SMTP Client
export {
    SMTPClient,
    type SendResult
} from './SMTPClient';

// POP3 Client
export {
    POP3Client,
    type MailboxStats,
    type MessageInfo,
    type POP3Result
} from './POP3Client';

// Email Client (end-user application)
export {
    EmailClient,
    HostEmailClientManager,
    hostEmailClientManager,
    type EmailFolder,
    type EmailClientStatus
} from './EmailClient';
