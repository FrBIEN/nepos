import * as dialogs from '../Dialogs';
import type { Host } from '../../hardware/Host';
import type { ApplicationContext } from '../../application/ApplicationContext';
import { Lifetime } from '../../core/Lifetime';
export interface AppOpenRequest {
    path?: string;
}
export interface HostApplicationContext {
    host: Host;
    content: HTMLElement;
    dependencies: ApplicationContext;
    request: AppOpenRequest;
    openApp: (id: string, request?: AppOpenRequest) => Promise<void>;
    closeApp: () => void;
    setDismissAction: (action: () => void, label: string) => void;
}
/** One mounted application owns its listeners, timers, guard and transient state. */
export abstract class HostApplication {
    readonly scope = new Lifetime();
    protected host: Host;
    protected element: HTMLElement;
    protected deps: ApplicationContext;
    protected leaveGuard: (() => Promise<boolean>) | null = null;
    protected leaveCommit: (() => void) | null = null;
    private leavePending: Promise<boolean> | null = null;
    constructor(protected context: HostApplicationContext) {
        this.host = context.host;
        this.element = context.content;
        this.deps = context.dependencies;
    }
    protected askText(message: string, value = '') { return dialogs.askText(message, value, this.scope.signal); }
    protected askConfirm(message: string) { return dialogs.askConfirm(message, this.scope.signal); }
    protected askSaveChanges(message: string) { return dialogs.askSaveChanges(message, this.scope.signal); }
    protected showNotice(message: string) { return dialogs.showNotice(message, this.scope.signal); }
    abstract mount(): void;
    flushPending(): void { }
    prepareClose(): Promise<boolean> {
        this.flushPending();
        if (!this.leaveGuard)
            return Promise.resolve(true);
        this.leavePending ??= this.leaveGuard().finally(() => { this.leavePending = null; });
        return this.leavePending;
    }
    commitLeave(): void { this.leaveCommit?.(); this.leaveCommit = null; this.leaveGuard = null; }
    dispose(): void { this.flushPending(); this.scope.dispose(); }
    protected setDismissAction(action: () => void, label: string): void { this.context.setDismissAction(action, label); }
    protected launchApp(id: string, request?: AppOpenRequest): Promise<void> { return this.context.openApp(id, request); }
}
