import type { AppId } from './Registry';
import { glyph } from '../Glyphs';
export interface AppMetadata {
    id: AppId;
    name: string;
    icon: string;
    category?: 'system' | 'network' | 'utility' | 'multimedia';
    required?: boolean; // If true, cannot be uninstalled (e.g., Terminal, SoftwareWizard)
}
export const AppRegistry = {
    apps: [
        { id: 'softwarewizard', name: 'Software-Installation', icon: glyph('softwarewizard'), category: 'system', required: true },
        { id: 'terminal', name: 'Terminal', icon: glyph('terminal'), category: 'system', required: true },
        { id: 'webbrowser', name: 'Web-Browser', icon: glyph('webbrowser'), category: 'network' },
        { id: 'webserver', name: 'Web-Server', icon: glyph('webserver'), category: 'network' },
        { id: 'dhcpserver', name: 'DHCP-Server', icon: glyph('dhcpserver'), category: 'network' },
        { id: 'dnsserver', name: 'DNS-Server', icon: glyph('dnsserver'), category: 'network' },
        { id: 'emailserver', name: 'E-Mail-Server', icon: glyph('emailserver'), category: 'network' },
        { id: 'emailclient', name: 'E-Mail-Programm', icon: glyph('emailclient'), category: 'network' },
        { id: 'echoserver', name: 'Echo-Server', icon: glyph('echoserver'), category: 'network' },
        { id: 'simpleclient', name: 'Einfacher Client', icon: glyph('simpleclient'), category: 'network' },
        { id: 'firewall', name: 'Firewall', icon: glyph('firewall'), category: 'network' },
        { id: 'peertopeer', name: 'Dateiaustausch', icon: glyph('peertopeer'), category: 'network' },
        { id: 'fileexplorer', name: 'Datei-Explorer', icon: glyph('fileexplorer'), category: 'utility' },
        { id: 'texteditor', name: 'Text-Editor', icon: glyph('texteditor'), category: 'utility' },
        { id: 'imageviewer', name: 'Bildanzeige', icon: glyph('imageviewer'), category: 'multimedia' },
    ] as AppMetadata[],
    getById(id: string): AppMetadata | undefined {
        return this.apps.find(app => app.id === id);
    },
    getAll(): AppMetadata[] {
        return this.apps;
    }
};
