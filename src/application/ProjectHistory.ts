import type { ScenarioData } from '../scenario/ScenarioTypes';

/** Bounded, atomic design snapshots. Simulation and project replacement start a new history. */
export class ProjectHistory {
    private states: string[] = [];
    private index = 0;
    private pending: ReturnType<typeof setTimeout> | undefined;
    private applying = false;
    private enabled = true;
    constructor(private capture: () => ScenarioData, private apply: (project: ScenarioData) => Promise<boolean>, private changed: () => void, private maxSteps = 50, private maxBytes = 32 * 1024 * 1024) { this.reset(); }
    get canUndo(): boolean { return this.enabled && !this.applying && (this.pending !== undefined || this.index > 0); }
    get canRedo(): boolean { return this.enabled && !this.applying && this.pending === undefined && this.index < this.states.length - 1; }
    schedule(): void {
        if (!this.enabled || this.applying) return;
        clearTimeout(this.pending);
        this.pending = setTimeout(() => this.flush(), 400);
        this.changed();
    }
    flush(): void {
        clearTimeout(this.pending); this.pending = undefined;
        if (!this.enabled || this.applying) return;
        const state = JSON.stringify(this.capture());
        if (state !== this.states[this.index]) {
            this.states = [...this.states.slice(0, this.index + 1), state]; this.index = this.states.length - 1;
            while (this.states.length > 1 && (this.states.length > this.maxSteps + 1 || this.states.reduce((sum, s) => sum + s.length * 2, 0) > this.maxBytes)) { this.states.shift(); --this.index; }
        }
        this.changed();
    }
    reset(): void { clearTimeout(this.pending); this.pending = undefined; this.states = [JSON.stringify(this.capture())]; this.index = 0; this.changed(); }
    setEnabled(enabled: boolean): void { this.enabled = enabled; this.reset(); }
    undo(): Promise<boolean> { return this.travel(-1); }
    redo(): Promise<boolean> { return this.travel(1); }
    private async travel(direction: number): Promise<boolean> {
        if (!this.enabled || this.applying) return false;
        this.flush(); const next = this.index + direction;
        if (next < 0 || next >= this.states.length) return false;
        this.applying = true; this.changed();
        try { if (!await this.apply(JSON.parse(this.states[next]))) return false; this.index = next; return true; }
        finally { this.applying = false; this.changed(); }
    }
    dispose(): void { clearTimeout(this.pending); this.pending = undefined; this.enabled = false; this.states = []; }
}
