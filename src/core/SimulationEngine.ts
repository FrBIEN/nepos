// SimulationEngine - Main simulation loop and state management

import { eventBus, Events } from './EventBus';

export type SimulationMode = 'design' | 'simulation';
export type SimulationState = 'stopped' | 'running' | 'paused';


export class SimulationEngine {
    constructor(private events = eventBus) {}
    private disposed = false;
    dispose(): void { if (this.disposed) return; this.stop(); this.disposed = true; }
    private mode: SimulationMode = 'design';
    private state: SimulationState = 'stopped';
    private simulationTime: number = 0; // Simulation time in ms
    private lastTickTime: number = 0;
    private tickInterval: number | null = null;
    private timers = new Map<number, { due: number; callback: () => void }>();
    private nextTimer = 1;
    private speedMultiplier: number = 1;

    // Tick rate: how often to process packets (16ms = ~60 ticks/sec for smooth physics)
    private readonly TICK_RATE_MS = 16;

    setTimeout(callback: () => void, delay: number): number {
        if (this.disposed) throw new Error('Simulation wurde aufgeräumt');
        const id = this.nextTimer++; this.timers.set(id, { due: this.simulationTime + Math.max(0, delay), callback }); return id;
    }
    clearTimeout(id: number): void { this.timers.delete(id); }

    getMode(): SimulationMode {
        return this.mode;
    }

    getState(): SimulationState {
        return this.state;
    }

    getSimulationTime(): number {
        return this.simulationTime;
    }

    setSpeedMultiplier(multiplier: number): void {
        if (Number.isFinite(multiplier)) this.speedMultiplier = Math.max(0.01, Math.min(10, multiplier));
    }

    getSpeedMultiplier(): number {
        return this.speedMultiplier;
    }

    switchToDesignMode(): boolean {
        if (this.state !== 'stopped') {
            this.stop();
        }
        if (this.mode !== 'design') {
            this.mode = 'design';
            this.events.emit(Events.MODE_CHANGE, { mode: 'design' });
        }
        return true;
    }

    switchToSimulationMode(): boolean {
        if (this.mode !== 'simulation') {
            this.mode = 'simulation';
            this.events.emit(Events.MODE_CHANGE, { mode: 'simulation' });
        }
        return true;
    }

    start(): boolean {
        if (this.disposed) return false;
        if (this.mode !== 'simulation') {
            this.switchToSimulationMode();
        }

        if (this.state === 'running') {
            return false;
        }

        this.state = 'running';
        this.lastTickTime = performance.now();

        this.tickInterval = globalThis.setInterval(() => {
            this.tick();
        }, this.TICK_RATE_MS) as unknown as number;

        this.events.emit(Events.SIMULATION_START, { time: this.simulationTime });
        return true;
    }

    pause(): boolean {
        if (this.state !== 'running') {
            return false;
        }

        this.state = 'paused';
        if (this.tickInterval !== null) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }

        this.events.emit(Events.SIMULATION_PAUSE, { time: this.simulationTime });
        return true;
    }

    resume(): boolean {
        if (this.state !== 'paused') {
            return false;
        }

        return this.start();
    }

    stop(): boolean {
        this.state = 'stopped';
        if (this.tickInterval !== null) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }

        this.timers.clear();
        this.events.emit(Events.SIMULATION_STOP, { time: this.simulationTime });
        return true;
    }

    reset(): void {
        this.stop();
        this.simulationTime = 0;
        this.switchToDesignMode();
    }

    /** One deterministic step, also used by the regression suite. */
    step(deltaMs: number = this.TICK_RATE_MS): void {
        if (this.disposed || !Number.isFinite(deltaMs) || deltaMs <= 0) return;
        this.simulationTime += deltaMs;
        this.events.emit(Events.SIMULATION_TICK, { time: this.simulationTime, deltaMs });
        for (const [id, timer] of [...this.timers]) if (this.simulationTime >= timer.due && this.timers.has(id)) {
            this.timers.delete(id); timer.callback();
        }
    }

    private tick(): void {
        const now = performance.now();
        const realDeltaMs = now - this.lastTickTime;
        this.lastTickTime = now;

        // Apply speed multiplier to simulation time
        const simDeltaMs = realDeltaMs * this.speedMultiplier;
        this.step(simDeltaMs);
    }
}

export const simulationEngine = new SimulationEngine();
