/** Owns resources for one view or application. Disposal is idempotent. */
export class Lifetime {
    private controller = new AbortController();
    private cleanups = new Set<() => void>();
    private timers = new Map<ReturnType<typeof setTimeout>, () => void>();
    get disposed(): boolean { return this.controller.signal.aborted; }
    get signal(): AbortSignal { return this.controller.signal; }
    add(cleanup: () => void): () => void {
        if (this.disposed)
            cleanup();
        else
            this.cleanups.add(cleanup);
        return () => { this.cleanups.delete(cleanup); };
    }
    child(): Lifetime { const child = new Lifetime(); const unlink = this.add(() => child.dispose()); child.add(unlink); return child; }
    listen<K extends keyof WindowEventMap>(target: Window, type: K, listener: (event: WindowEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void;
    listen<K extends keyof HTMLElementEventMap>(target: EventTarget | null | undefined, type: K, listener: (event: HTMLElementEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void;
    listen(target: EventTarget | null | undefined, type: string, listener: (event: never) => void, options: boolean | AddEventListenerOptions = {}): void {
        if (!target || this.disposed)
            return;
        const config = typeof options === 'boolean' ? { capture: options } : options;
        target.addEventListener(type, listener as EventListener, { ...config, signal: this.signal });
    }
    timeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
        const id = setTimeout(() => {
            this.timers.delete(id);
            this.cleanups.delete(cleanup);
            if (!this.disposed)
                callback();
        }, delay);
        const cleanup = () => { clearTimeout(id); this.timers.delete(id); };
        this.timers.set(id, cleanup);
        this.add(cleanup);
        return id;
    }
    cancelTimeout(id: ReturnType<typeof setTimeout>): void {
        const cleanup = this.timers.get(id);
        cleanup?.();
        if (cleanup)
            this.cleanups.delete(cleanup);
    }
    interval(callback: () => void, delay: number): ReturnType<typeof setInterval> {
        const id = setInterval(() => {
            if (!this.disposed)
                callback();
        }, delay);
        this.add(() => clearInterval(id));
        return id;
    }
    dispose(): void {
        if (this.disposed)
            return;
        this.controller.abort();
        // A failed disposer must not leave the remaining resources alive.
        const errors: unknown[] = [];
        for (const cleanup of [...this.cleanups].reverse())
            try {
                cleanup();
            }
            catch (error) {
                errors.push(error);
            }
        this.cleanups.clear();
        this.timers.clear();
        if (errors.length)
            console.error('Fehler beim Aufräumen:', errors);
    }
}
