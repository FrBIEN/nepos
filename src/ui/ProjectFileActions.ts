import type { ProjectController } from '../application/ProjectController';
import { Lifetime } from '../core/Lifetime';
import { chooseProject, downloadProject, showProjectNotices, showProjectRecovery } from './ProjectFiles';
import { askConfirm } from './Dialogs';
/** File dialogs are UI adapters; project mutations remain in ProjectController. */
export class ProjectFileActions {
    private scope = new Lifetime();
    constructor(private project: ProjectController, private isSimulation: () => boolean) {
        this.scope.listen(document.getElementById('btn-save'), 'click', () => {
            try {
                downloadProject(project.capture(), this.scope.signal);
            }
            catch (error) {
                this.error(error, 'Projekt konnte nicht gespeichert werden');
            }
        });
        this.scope.listen(document.getElementById('btn-load'), 'click', () => { void this.load(); });
        this.scope.listen(document.getElementById('btn-new'), 'click', () => { void this.newProject(); });
        this.scope.listen(document.getElementById('btn-recovery'), 'click', () => this.showRecovery());
    }
    showRecovery(): void {
        const recovery = this.project.recovery();
        showProjectRecovery(recovery.message ?? 'Sichern Sie einen vorhandenen Projektstand als Datei und öffnen Sie ihn anschließend über „Laden“. Ältere Teildaten stehen zusätzlich zur Rettung bereit.', recovery.documents, recovery.resume ? () => {
            const success = recovery.resume!();
            if (success) {
                const status = document.getElementById('status-text');
                if (status)
                    status.textContent = 'Projekt wiederhergestellt – automatisches Speichern aktiv';
            }
            return success;
        } : undefined, this.scope.signal);
    }
    private error(error: unknown, title: string): void {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
            showProjectNotices([error instanceof Error ? error.message : String(error)], title, this.scope.signal);
    }
    private async load(): Promise<void> {
        if (this.isSimulation() || this.project.busy)
            return;
        try {
            const { scenario, warnings } = await chooseProject(this.scope.signal);
            if (this.scope.disposed || this.isSimulation() || !await askConfirm('Aktuelles Projekt durch die ausgewählte Datei ersetzen?', this.scope.signal))
                return;
            if (await this.project.replace(scenario))
                showProjectNotices(warnings, undefined, this.scope.signal);
        }
        catch (error) {
            this.error(error, 'Netz konnte nicht geladen werden');
        }
    }
    private async newProject(): Promise<void> {
        if (this.isSimulation() || this.project.busy || !await askConfirm('Aktuelles Projekt verwerfen?', this.scope.signal))
            return;
        if (this.scope.disposed)
            return;
        try {
            await this.project.newProject();
        }
        catch (error) {
            this.error(error, 'Projekt konnte nicht angelegt werden');
        }
    }
    dispose(): void { this.scope.dispose(); }
}
