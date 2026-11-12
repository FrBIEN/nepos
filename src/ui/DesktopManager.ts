import type { Host } from '../hardware/Host';
import type { ApplicationContext } from '../application/ApplicationContext';
import { DesktopWindow } from './DesktopWindow';
import { Events } from '../core/EventBus';
import { Lifetime } from '../core/Lifetime';
/** Owns desktop instances and the aggregate close guard for project/mode transitions. */
export class DesktopManager {
    private windows = new Map<string, DesktopWindow>();
    private scope = new Lifetime();
    constructor(private context: ApplicationContext) {
        this.scope.add(context.events.on(Events.DESKTOP_CLOSE, ({ host }: {
            host: Host;
        }) => this.windows.delete(host.getId())).unsubscribe);
    }
    open(host: Host): void {
        if (this.scope.disposed)
            return;
        const existing = this.windows.get(host.getId());
        if (existing) {
            existing.show();
            return;
        }
        this.windows.set(host.getId(), new DesktopWindow(host, this.context));
    }
    flushPending(): void {
        for (const window of this.windows.values())
            window.flushPending();
    }
    async prepareClose(): Promise<boolean> {
        for (const window of this.windows.values())
            if (!await window.prepareClose())
                return false;
        return true;
    }
    closeAll(): void {
        for (const window of this.windows.values())
            void window.close(true);
        this.windows.clear();
    }
    dispose(): void { this.closeAll(); this.scope.dispose(); }
}
