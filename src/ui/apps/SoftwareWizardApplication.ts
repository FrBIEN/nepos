import { HostApplication } from './HostApplication';
import { Lifetime } from '../../core/Lifetime';
import { AppRegistry } from './AppCatalog';
import { Events } from '../../core/EventBus';
export class SoftwareWizardApplication extends HostApplication {
    private renderScope = new Lifetime();
    mount(): void {
        this.renderScope.dispose();
        this.renderScope = this.scope.child();
        this.element.innerHTML = this.createUI();
        this.setupEventListeners(this.element);
    }
    private createUI(): string {
        const apps = AppRegistry.getAll();
        return `
            <div class="software-wizard" style="height: 100%; display: flex; flex-direction: column;">
                <div class="wizard-header" style="padding: 16px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <h2 style="margin: 0;">Software-Installation</h2>
                        <p style="margin: 8px 0 0; color: var(--text-secondary);">Wählen Sie Anwendungen aus, die auf diesem ${this.host.getType() === 'notebook' ? 'Notebook' : 'PC'} verfügbar sein sollen.</p>
                    </div>
                </div>
                <div class="wizard-list" style="flex: 1; overflow-y: auto; padding: 16px;">
                    ${apps.map(app => this.renderAppItem(app)).join('')}
                </div>
            </div>
        `;
    }
    private renderAppItem(app: import('./AppCatalog').AppMetadata): string {
        const isInstalled = this.host.isAppInstalled(app.id);
        const isRequired = app.required;
        return `
            <div class="app-item" style="display: flex; align-items: center; padding: 12px; border-bottom: 1px solid var(--border-color); gap: 12px;">
                <div class="app-icon" style="font-size: 2rem;">${app.icon}</div>
                <div class="app-info" style="flex: 1;">
                    <div style="font-weight: bold;">${app.name}</div>

                </div>
                <div class="app-actions" style="display: flex; gap: 8px;">
                    ${!isRequired ? `
                        <button class="btn btn-sm ${isInstalled ? 'btn-danger' : 'btn-primary'} toggle-install-btn"
                                data-appid="${app.id}"
                                style="min-width: 100px;">
                            ${isInstalled ? 'Deinstallieren' : 'Installieren'}
                        </button>
                    ` : '<span style="color: var(--text-secondary); font-size: 0.9rem;">System</span>'}

                    ${isInstalled && !isRequired ? `
                        <button class="btn btn-sm btn-secondary purge-btn"
                                data-appid="${app.id}"
                                title="Konfiguration zurücksetzen">
                            Reset
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }
    private setupEventListeners(container: HTMLElement): void {
        // Install/Uninstall
        container.querySelectorAll('.toggle-install-btn').forEach(btn => {
            this.renderScope.listen(btn, 'click', (e) => {
                const appId = (e.target as HTMLElement).dataset.appid;
                if (!appId)
                    return;
                if (this.host.isAppInstalled(appId)) {
                    this.host.uninstallApp(appId);
                    const hostId = this.host.getId();
                    if (appId === 'webserver')
                        this.deps.hostServerManager.getServer(hostId)?.stop();
                    if (appId === 'dhcpserver')
                        this.deps.hostDhcpServerManager.getServer(hostId)?.stop();
                    if (appId === 'dnsserver')
                        this.deps.hostDnsServerManager.getServer(hostId)?.stop();
                    if (appId === 'emailserver')
                        this.deps.hostEmailServerManager.getServer(hostId)?.stop();
                    if (appId === 'echoserver')
                        this.deps.hostEchoServerManager.getServer(hostId)?.stop();
                    if (appId === 'peertopeer')
                        this.deps.peerToPeerManager.get(hostId)?.stop();
                    if (appId === 'firewall')
                        this.host.setFirewall({ ...this.host.getFirewall(), enabled: false });
                }
                else {
                    this.host.installApp(appId);
                }
                // Refresh UI
                this.mount();
                // Notify Desktop to update icons
            });
        });
        // Purge
        container.querySelectorAll('.purge-btn').forEach(btn => {
            this.renderScope.listen(btn, 'click', async (e) => {
                const appId = (e.target as HTMLElement).dataset.appid;
                if (!appId)
                    return;
                if (await this.askConfirm(`Möchten Sie die Konfiguration für ${appId} wirklich zurücksetzen? Alle Einstellungen gehen verloren.`)) {
                    await this.purgeApp(appId);
                    void this.showNotice('Konfiguration wurde zurückgesetzt.');
                }
            });
        });
    }
    private async purgeApp(appId: string): Promise<void> {
        const hostId = this.host.getId();
        switch (appId) {
            case 'webserver':
                this.deps.hostServerManager.removeServer(hostId);
                this.deps.hostFileSystemManager.getFileSystem(hostId)?.delete('/web', true);
                break;
            case 'dhcpserver':
                this.deps.hostDhcpServerManager.removeServer(hostId);
                break;
            case 'dnsserver':
                this.deps.hostDnsServerManager.removeServer(hostId);
                break;
            case 'emailserver':
                this.deps.hostEmailServerManager.removeServer(hostId);
                break;
            case 'emailclient':
                this.deps.hostEmailClientManager.removeClient(hostId);
                break;
            case 'echoserver':
                this.deps.hostEchoServerManager.removeServer(hostId);
                break;
            case 'peertopeer':
                this.deps.peerToPeerManager.remove(hostId);
                break;
            case 'firewall':
                this.host.setFirewall({ enabled: false, blockICMP: false, rules: [] });
                break;
        }
        this.deps.events.emit(Events.SERVICE_STATE_CHANGED, { host: this.host });
    }
}
