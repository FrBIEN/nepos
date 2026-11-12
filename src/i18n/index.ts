// i18n - Internationalization system
export type Locale = 'de' | 'en';

interface Translations {
    [key: string]: string | Translations;
}

const translations: Record<Locale, Translations> = {
    de: {
        app: {
            title: 'Nepos',
            designMode: 'Entwurfsmodus',
            simulationMode: 'Simulationsmodus',
        },
        devices: {
            computer: 'PC',
            notebook: 'Notebook',
            switch: 'Switch',
            router: 'Router',
            cable: 'Kabel',
        },
        config: {
            name: 'Name',
            ipAddress: 'IP-Adresse',
            subnetMask: 'Subnetzmaske',
            gateway: 'Gateway',
            dns: 'DNS-Server',
            macAddress: 'MAC-Adresse',
            useDHCP: 'DHCP verwenden',
        },
        actions: {
            start: 'Starten',
            stop: 'Stoppen',
            pause: 'Pausieren',
            save: 'Speichern',
            load: 'Laden',
            new: 'Neu',
            delete: 'Löschen',
            connect: 'Verbinden',
        },
        apps: {
            terminal: 'Terminal',
            webBrowser: 'Webbrowser',
            webServer: 'Webserver',
            dnsServer: 'DNS-Server',
            dhcpServer: 'DHCP-Server',
            fileExplorer: 'Datei-Explorer',
        },
        terminal: {
            commands: {
                help: 'Verfügbare Befehle anzeigen',
                ping: 'Ping zu einer IP-Adresse',
                traceroute: 'Route zu einer IP-Adresse verfolgen',
                ipconfig: 'Netzwerkkonfiguration anzeigen',
                arp: 'ARP-Tabelle anzeigen',
                route: 'Routing-Tabelle anzeigen',
            },
        },
        messages: {
            pingSuccess: 'Antwort von {ip}: Zeit={time}ms TTL={ttl}',
            pingTimeout: 'Zeitüberschreitung der Anforderung.',
            hostUnreachable: 'Zielhost nicht erreichbar.',
            networkUnreachable: 'Zielnetz nicht erreichbar.',
        },
    },
    en: {
        app: {
            title: 'Nepos',
            designMode: 'Design Mode',
            simulationMode: 'Simulation Mode',
        },
        devices: {
            computer: 'PC',
            notebook: 'Notebook',
            switch: 'Switch',
            router: 'Router',
            cable: 'Cable',
        },
        config: {
            name: 'Name',
            ipAddress: 'IP Address',
            subnetMask: 'Subnet Mask',
            gateway: 'Gateway',
            dns: 'DNS Server',
            macAddress: 'MAC Address',
            useDHCP: 'Use DHCP',
        },
        actions: {
            start: 'Start',
            stop: 'Stop',
            pause: 'Pause',
            save: 'Save',
            load: 'Load',
            new: 'New',
            delete: 'Delete',
            connect: 'Connect',
        },
        apps: {
            terminal: 'Terminal',
            webBrowser: 'Web Browser',
            webServer: 'Web Server',
            dnsServer: 'DNS Server',
            dhcpServer: 'DHCP Server',
            fileExplorer: 'File Explorer',
        },
        terminal: {
            commands: {
                help: 'Show available commands',
                ping: 'Ping an IP address',
                traceroute: 'Trace route to an IP address',
                ipconfig: 'Show network configuration',
                arp: 'Show ARP table',
                route: 'Show routing table',
            },
        },
        messages: {
            pingSuccess: 'Reply from {ip}: time={time}ms TTL={ttl}',
            pingTimeout: 'Request timed out.',
            hostUnreachable: 'Destination host unreachable.',
            networkUnreachable: 'Destination network unreachable.',
        },
    },
};

class I18n {
    private currentLocale: Locale = 'de';
    private listeners: Set<() => void> = new Set();

    setLocale(locale: Locale): void {
        if (this.currentLocale !== locale) {
            this.currentLocale = locale;
            localStorage.setItem('filius-locale', locale);
            this.notifyListeners();
        }
    }

    getLocale(): Locale {
        return this.currentLocale;
    }

    t(key: string, params?: Record<string, string | number>): string {
        const keys = key.split('.');
        let value: string | Translations = translations[this.currentLocale];

        for (const k of keys) {
            if (typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                console.warn(`Translation missing for key: ${key}`);
                return key;
            }
        }

        if (typeof value !== 'string') {
            console.warn(`Translation key ${key} is not a string`);
            return key;
        }

        // Replace parameters like {ip} with actual values
        if (params) {
            return value.replace(/\{(\w+)\}/g, (_, paramName) =>
                String(params[paramName] ?? `{${paramName}}`)
            );
        }

        return value;
    }

    onLocaleChange(callback: () => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    private notifyListeners(): void {
        this.listeners.forEach(cb => cb());
    }

    init(): void {
        const saved = localStorage.getItem('filius-locale') as Locale | null;
        if (saved && (saved === 'de' || saved === 'en')) {
            this.currentLocale = saved;
        }
    }
}

export const i18n = new I18n();
