import { i18n } from '../i18n';
import type { ApplicationContext } from '../application/ApplicationContext';
import type { SimulationMode } from '../core/SimulationEngine';
/** Toolbar/sidebar rendering has no protocol lifecycle responsibilities. */
export class ModeControls {
    constructor(private context: ApplicationContext) { }
    render(mode: SimulationMode): void {
        const simulation = mode === 'simulation';
        document.getElementById('mode-design')?.classList.toggle('active', !simulation);
        document.getElementById('mode-simulation')?.classList.toggle('active', simulation);
        document.body.classList.toggle('simulation-mode', simulation);
        for (const id of ['btn-new', 'btn-load', 'btn-delete', 'btn-save', 'btn-tab-devices']) {
            const node = document.getElementById(id);
            if (node)
                node.style.display = simulation ? 'none' : id === 'btn-tab-devices' ? 'block' : 'inline-flex';
        }
        const packets = document.getElementById('btn-packet-log');
        if (packets)
            packets.style.display = simulation ? 'inline-flex' : 'none';
        const speed = document.getElementById('speed-control');
        if (speed)
            speed.style.display = simulation ? 'flex' : 'none';
        const sidebar = document.getElementById('sidebar');
        if (sidebar)
            sidebar.style.display = 'flex';
        if (simulation && document.getElementById('btn-tab-devices')?.classList.contains('active'))
            document.getElementById('btn-tab-config')?.click();
        if (!simulation)
            this.context.packets.hide();
        const hint = document.getElementById('canvas-hint');
        if (hint)
            hint.textContent = simulation ? 'Gerät antippen und Anwendungen öffnen' : 'Gerät auswählen und auf die Fläche tippen';
        this.playback();
    }
    playback(): void {
        const engine = this.context.simulation, simulation = engine.getMode() === 'simulation', running = engine.getState() === 'running';
        const status = document.getElementById('status-text');
        if (status)
            status.textContent = simulation ? i18n.t('app.simulationMode') + (running ? ' (läuft)' : ' (pausiert)') : i18n.t('app.designMode');
        const dot = document.getElementById('status-dot');
        dot?.classList.toggle('running', simulation && running);
        dot?.classList.toggle('paused', simulation && !running);
        const button = document.getElementById('btn-play-pause');
        if (button) {
            button.title = running ? 'Pause' : 'Start';
            button.setAttribute('aria-label', button.title);
            button.innerHTML = running ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
        }
    }
}
