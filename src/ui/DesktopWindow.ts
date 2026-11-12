import { showNotice } from './Dialogs';
import { Host } from '../hardware/Host';
import { Lifetime } from '../core/Lifetime';
import { Events } from '../core/EventBus';
import type { ApplicationContext } from '../application/ApplicationContext';
import { createDismissButton } from './DismissButton';
import { escapeHTML } from './html';
import { WindowManager } from './WindowManager';
import { AppRegistry } from './apps/AppCatalog';
import { createHostApplication } from './apps/Registry';
import type { HostApplication, AppOpenRequest } from './apps/HostApplication';
interface WindowPosition {
    x: number;
    y: number;
    width: number;
    height: number;
}
/** Window shell: application rendering and state belong to independently mounted views. */
export class DesktopWindow {
    private element: HTMLElement;
    private scope = new Lifetime();
    private gridScope = this.scope.child();
    private activeApp: HostApplication | null = null;
    private dismissAction: (() => void) | null = null;
    private transitionPending = false;
    private position: WindowPosition;
    constructor(private host: Host, private deps: ApplicationContext) {
        this.position = { x: 100 + Math.random() * 200, y: 80 + Math.random() * 80, width: 700, height: 500 };
        this.element = this.createWindow();
        document.body.append(this.element);
        this.focus();
    }
    private focus(): void { WindowManager.bringToFront(this.element); }
    private setDismissAction(action: (() => void) | null, label: string): void {
        this.dismissAction = action;
        const button = this.element.querySelector<HTMLButtonElement>('.window-dismiss')!;
        button.title = label;
        button.setAttribute('aria-label', label);
    }
    flushPending(): void { this.activeApp?.flushPending(); }
    prepareClose(): Promise<boolean> { return this.activeApp?.prepareClose() ?? Promise.resolve(true); }
    private disposeApplication(commit: boolean): void {
        const app = this.activeApp;
        this.activeApp = null;
        if (commit)
            app?.commitLeave();
        app?.dispose();
    }
    private async dismiss(): Promise<void> {
        if (this.transitionPending)
            return;
        this.transitionPending = true;
        try {
            if (!await this.prepareClose())
                return;
            if (this.scope.disposed)
                return;
            if (this.dismissAction)
                this.dismissAction();
            else
                await this.close(true);
        }
        finally {
            this.transitionPending = false;
        }
    }
    private async launchApp(appId: string, request: AppOpenRequest = {}): Promise<void> {
        if (this.transitionPending || this.scope.disposed)
            return;
        this.transitionPending = true;
        try {
            if (!await this.prepareClose() || this.scope.disposed)
                return;
            this.disposeApplication(true);
            this.setDismissAction(() => this.showDesktop(), 'Anwendung schließen');
            const content = this.element.querySelector<HTMLElement>('.desktop-window-content')!;
            const app = createHostApplication(appId, { host: this.host, content, dependencies: this.deps, request,
                openApp: (id, options) => this.launchApp(id, options), closeApp: () => this.showDesktop(),
                setDismissAction: (action, label) => this.setDismissAction(action, label) });
            this.activeApp = app;
            try {
                app.mount();
            }
            catch (error) {
                this.disposeApplication(false);
                this.showDesktop();
                throw error;
            }
            content.querySelectorAll('label').forEach((label, index) => {
                if (label.htmlFor || label.querySelector('input'))
                    return;
                const control = label.nextElementSibling as HTMLInputElement | null;
                if (control && ['INPUT', 'SELECT', 'TEXTAREA'].includes(control.tagName)) {
                    if (!control.id)
                        control.id = this.host.getId() + '-field-' + index;
                    label.htmlFor = control.id;
                }
            });
            this.deps.events.emit(Events.APP_LAUNCH, { host: this.host, appId });
        }
        catch (error) {
            this.showDesktop();
            void showNotice('Anwendung konnte nicht geöffnet werden: ' + (error instanceof Error ? error.message : String(error)),this.scope.signal);
        }
        finally {
            this.transitionPending = false;
        }
    }
    private showDesktop(): void {
        this.disposeApplication(true);
        this.setDismissAction(null, 'Desktop schließen');
        const content = this.element.querySelector<HTMLElement>('.desktop-window-content')!;
        content.innerHTML = '<div class="app-grid">' + this.renderAppIcons() + '</div>';
        this.setupAppIconListeners(content);
    }
    private createWindow(): HTMLElement {
        const div = document.createElement('div');
        div.className = 'desktop-window';
        div.style.left = `${this.position.x}px`;
        div.style.top = `${this.position.y}px`;
        div.style.width = `${this.position.width}px`;
        div.style.height = `${this.position.height}px`;
        div.innerHTML = `
      <div class="desktop-window-header">
        <span class="desktop-window-title">${escapeHTML(this.host.getDisplayName())}</span>
        <div class="desktop-window-controls">
          <button class="btn-minimize" title="Minimieren">─</button>
        </div>
      </div>
      <div class="desktop-window-content">
        <div class="app-grid" id="app-grid-${this.host.getId()}">
          ${this.renderAppIcons()}
        </div>
      </div>
    `;
        // Focus on click
        this.scope.listen(div, 'pointerdown', () => this.focus());
        this.scope.listen(div, 'pointerup', e => {
            if (e.pointerType === 'touch') {
                const item = (e.target as HTMLElement).closest<HTMLElement>('.dlg-item[data-type="dir"]');
                item?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            }
        });
        // Header drag
        const header = div.querySelector('.desktop-window-header') as HTMLElement;
        this.scope.listen(header, 'pointerdown', this.startPointerDrag.bind(this));
        // Minimize retains the host desktop for reopening from the network.
        this.scope.listen(div.querySelector('.btn-minimize'), 'click', () => this.hide());
        div.append(createDismissButton(() => { void this.dismiss(); }, 'Desktop schließen'));
        // App icon clicks
        this.setupAppIconListeners(div);
        return div;
    }
    private setupAppIconListeners(container: HTMLElement): void {
        this.gridScope.dispose();
        this.gridScope = this.scope.child();
        container.querySelectorAll('.app-icon').forEach(icon => {
            icon.setAttribute('role', 'button');
            (icon as HTMLElement).tabIndex = 0;
            this.gridScope.listen(icon, 'keydown', e => {
                const event = e as KeyboardEvent;
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    (icon as HTMLElement).click();
                }
            });
            this.gridScope.listen(icon, 'click', (e) => {
                const appId = (e.currentTarget as HTMLElement).dataset.app;
                if (appId)
                    this.launchApp(appId);
            });
        });
    }
    private renderAppIcons(): string {
        const apps = AppRegistry.getAll();
        const installedApps = apps.filter(app => this.host.isAppInstalled(app.id));
        return installedApps.map(app => {
            let statusIndicator = '';
            // Add running status indicators for servers
            if (app.id === 'webserver' && this.deps.hostServerManager.getServer(this.host.getId())?.isRunning())
                statusIndicator = ' 🟢';
            if (app.id === 'dhcpserver' && this.deps.hostDhcpServerManager.getServer(this.host.getId())?.isRunning())
                statusIndicator = ' 🟢';
            if (app.id === 'dnsserver' && this.deps.hostDnsServerManager.getServer(this.host.getId())?.isRunning())
                statusIndicator = ' 🟢';
            if (app.id === 'emailserver' && this.deps.hostEmailServerManager.getServer(this.host.getId())?.isRunning())
                statusIndicator = ' 🟢';
            if (app.id === 'echoserver' && this.deps.hostEchoServerManager.getServer(this.host.getId())?.isRunning())
                statusIndicator = ' 🟢';
            return `
      <div class="app-icon" data-app="${app.id}">
        <span style="font-size: 2.5rem;">${app.icon}</span>
        <span>${app.name}${statusIndicator}</span>
      </div>
    `;
        }).join('');
    }
    private startPointerDrag(e: PointerEvent): void {
        if (window.innerWidth <= 1100 || (e.target as HTMLElement).closest('button'))
            return;
        const header = e.currentTarget as HTMLElement;
        header.setPointerCapture(e.pointerId);
        const offset = { x: e.clientX - this.element.offsetLeft, y: e.clientY - this.element.offsetTop };
        const move = (event: PointerEvent) => {
            this.position.x = Math.max(0, Math.min(window.innerWidth - this.element.offsetWidth, event.clientX - offset.x));
            this.position.y = Math.max(0, Math.min(window.innerHeight - 64, event.clientY - offset.y));
            this.element.style.left = `${this.position.x}px`;
            this.element.style.top = `${this.position.y}px`;
        };
        const stop = () => { header.removeEventListener('pointermove', move); header.removeEventListener('pointerup', stop); header.removeEventListener('pointercancel', stop); };
        this.scope.listen(header, 'pointermove', move);
        this.scope.listen(header, 'pointerup', stop);
        this.scope.listen(header, 'pointercancel', stop);
    }
    show(): void {
        if (!this.scope.disposed) {
            this.element.style.display = 'flex';
            this.focus();
        }
    }
    hide(): void { this.element.style.display = 'none'; }
    async close(prepared = false): Promise<boolean> {
        if (this.scope.disposed)
            return true;
        if (!prepared && !await this.prepareClose())
            return false;
        this.disposeApplication(true);
        this.scope.dispose();
        this.element.remove();
        this.deps.events.emit(Events.DESKTOP_CLOSE, { host: this.host });
        return true;
    }
    getHost(): Host { return this.host; }
}
