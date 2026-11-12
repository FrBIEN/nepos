import type { HostApplicationContext } from './HostApplication';
import { TerminalApplication } from './TerminalApplication';
import { BrowserApplication } from './BrowserApplication';
import { WebServerApplication } from './WebServerApplication';
import { DHCPServerApplication } from './DHCPServerApplication';
import { DNSServerApplication } from './DNSServerApplication';
import { FileExplorerApplication } from './FileExplorerApplication';
import { TextEditorApplication } from './TextEditorApplication';
import { PeerToPeerApplication } from './PeerToPeerApplication';
import { FirewallApplication } from './FirewallApplication';
import { EchoServerApplication } from './EchoServerApplication';
import { SimpleClientApplication } from './SimpleClientApplication';
import { EmailServerApplication } from './EmailServerApplication';
import { EmailClientApplication } from './EmailClientApplication';
import { ImageViewerApplication } from './ImageViewerApplication';
import { SoftwareWizardApplication } from './SoftwareWizardApplication';
import { HostApplication } from './HostApplication';
const applications = { terminal: TerminalApplication, webbrowser: BrowserApplication, webserver: WebServerApplication,
    dhcpserver: DHCPServerApplication, dnsserver: DNSServerApplication, fileexplorer: FileExplorerApplication,
    texteditor: TextEditorApplication, peertopeer: PeerToPeerApplication, firewall: FirewallApplication,
    echoserver: EchoServerApplication, simpleclient: SimpleClientApplication, emailserver: EmailServerApplication,
    emailclient: EmailClientApplication, imageviewer: ImageViewerApplication, softwarewizard: SoftwareWizardApplication };
export type AppId = keyof typeof applications;
export function createHostApplication(id: string, context: HostApplicationContext): HostApplication {
    if (!Object.hasOwn(applications, id))
        throw new Error('Unbekannte Anwendung: ' + id);
    return new applications[id as AppId](context);
}
