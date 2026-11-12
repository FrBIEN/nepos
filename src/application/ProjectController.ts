import type { Knoten } from '../hardware/Knoten';
import type { Kabel } from '../hardware/Kabel';
import type { ScenarioData, DocElementData, ServiceState } from '../scenario/ScenarioTypes';
import type { ScenarioManager } from '../scenario/ScenarioManager';
import type { ProjectStore } from '../scenario/ProjectStore';
import { Lifetime } from '../core/Lifetime';
export interface ProjectWorkspace {
    nodes(): Knoten[];
    cables(): Kabel[];
    documents(): DocElementData[];
    replace(nodes: Knoten[], cables: Kabel[], documents: DocElementData[], preserveConnections?: boolean): void;
}
export interface ProjectDependencies {
    store: ProjectStore;
    scenarios: ScenarioManager;
    services: {
        snapshot(nodes: Knoten[]): ServiceState;
        replace(state: Partial<ServiceState>, nodes: Knoten[], previous: Knoten[]): void;
    };
    network: {
        updateTopology(nodes: Knoten[], cables: Kabel[]): void;
    };
    workspace: ProjectWorkspace;
    windows: {
        prepareClose(): Promise<boolean>;
        closeAll(): void;
        flushPending?(): void;
    };
    onMetadata: (name: string, description: string) => void;
    onError: (message: string, error: unknown) => void;
    onReplaced?: () => void;
    onNew?: () => void;
}
/** Project ownership, recovery, persistence and replacement without DOM or browser file APIs. */
export class ProjectController {
    private scope = new Lifetime();
    private saveTimer: ReturnType<typeof setTimeout> | undefined;
    private changing = false;
    private blocked = false;
    private canResume = false;
    private title = '';
    private createdAt=new Date().toISOString();
    private description = '';
    recoveryMessage: string | null = null;
    constructor(private deps: ProjectDependencies) { }
    get autosaveBlocked(): boolean { return this.blocked; }
    get busy(): boolean { return this.changing; }
    setMetadata(name: string, description: string): void {
        this.title = name;
        this.description = description;
        this.scheduleSave();
    }
    private metadata(project: ScenarioData): void {
        this.title = project.name;
        this.createdAt=project.createdAt??this.createdAt;
        this.description = project.description ?? '';
        this.deps.onMetadata(this.title, this.description);
    }
    capture(): ScenarioData {
        this.deps.windows.flushPending?.();
        const workspace = this.deps.workspace, nodes = workspace.nodes();
        const project = this.deps.scenarios.exportScenario(nodes, workspace.cables(), this.title || 'Nepos-Netzwerk', this.deps.services.snapshot(nodes));
        project.createdAt=this.createdAt;
        project.description = this.description;
        project.docElements = workspace.documents();
        return project;
    }
    restore(): void {
        try {
            const project = this.deps.store.load();
            if (project) {
                const result = this.deps.scenarios.importScenario(project, false);
                this.deps.services.replace(project.serviceState ?? {}, result.nodes, this.deps.workspace.nodes());
                this.deps.workspace.replace(result.nodes, result.cables, project.docElements ?? []);
                this.deps.network.updateTopology(result.nodes, result.cables);
                this.deps.scenarios.commitScenario(project);
                this.metadata(project);
            }
            this.recoveryMessage = this.deps.store.loadWarning;
            this.canResume = !!project && !!this.recoveryMessage;
        }
        catch (error) {
            this.recoveryMessage = 'Das gespeicherte Projekt konnte nicht wiederhergestellt werden. Die Daten bleiben erhalten. Automatisches Speichern ist gesperrt. ' + (error instanceof Error ? error.message : String(error));
            this.canResume = false;
        }
        this.blocked = !!this.recoveryMessage;
    }
    recovery() { return { message: this.recoveryMessage, documents: this.deps.store.recoveryDocuments(), resume: this.canResume ? () => this.resumeRecovery() : undefined }; }
    private resumeRecovery(): boolean {
        try {
            this.deps.store.save(this.capture());
            this.blocked = false;
            this.canResume = false;
            this.recoveryMessage = null;
            return true;
        }
        catch (error) {
            this.deps.onError('Speichern fehlgeschlagen', error);
            return false;
        }
    }
    persist(): boolean {
        if (this.scope.disposed || this.blocked || this.changing)
            return false;
        try {
            this.deps.store.save(this.capture());
            return true;
        }
        catch (error) {
            this.deps.onError('Automatisches Speichern fehlgeschlagen', error);
            return false;
        }
    }
    scheduleSave(): void {
        if (this.scope.disposed || this.changing)
            return;
        if (this.saveTimer !== undefined)
            clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => { this.saveTimer = undefined; this.persist(); }, 500);
    }
    /** Prevent overlapping guards/imports. A rejected operation leaves the existing workspace intact. */
    async replace(project: ScenarioData, isNew = false): Promise<boolean> {
        if (this.changing || this.scope.disposed)
            return false;
        this.changing = true;
        if (this.saveTimer !== undefined) {
            clearTimeout(this.saveTimer);
            this.saveTimer = undefined;
        }
        let success = false;
        try {
            const result = this.deps.scenarios.importScenario(project, false);
            if (!await this.deps.windows.prepareClose() || this.scope.disposed)
                return false;
            const previous = this.capture();
            this.deps.store.checkpoint(previous);
            if (isNew)
                this.deps.store.clear();
            else if (!this.blocked)
                this.deps.store.save(previous);
            this.deps.windows.closeAll();
            this.deps.services.replace(project.serviceState ?? {}, result.nodes, this.deps.workspace.nodes());
            this.deps.workspace.replace(result.nodes, result.cables, project.docElements ?? []);
            this.deps.network.updateTopology(result.nodes, result.cables);
            this.deps.scenarios.commitScenario(project);
            this.metadata(project);
            if (isNew)
                this.deps.onNew?.();
            this.blocked = false;
            this.canResume = false;
            this.recoveryMessage = null;
            success = true;
            this.deps.onReplaced?.();
            return true;
        }
        finally {
            this.changing = false;
            // Changes made while answering a guard must also be saved when the operation is cancelled.
            if (success)
                this.persist();
            else
                this.scheduleSave();
        }
    }
    async applyHistory(project: ScenarioData): Promise<boolean> {
        if (this.changing || this.scope.disposed) return false;
        this.changing = true;
        try {
            const graph = this.deps.scenarios.importScenario(project, false);
            if (!await this.deps.windows.prepareClose() || this.scope.disposed) return false;
            this.deps.windows.closeAll();
            this.deps.services.replace(project.serviceState ?? {}, graph.nodes, this.deps.workspace.nodes());
            this.deps.workspace.replace(graph.nodes, graph.cables, project.docElements ?? [], true);
            this.deps.network.updateTopology(graph.nodes, graph.cables);
            this.deps.scenarios.commitScenario(project); this.metadata(project);
            return true;
        } finally { this.changing = false; this.scheduleSave(); }
    }
    newProject(): Promise<boolean> {
        return this.replace({ version: '1.0', name: '', description: '', createdAt: new Date().toISOString(), nodes: [], cables: [] }, true);
    }
    dispose(): void {
        if (this.saveTimer !== undefined)
            clearTimeout(this.saveTimer);
        this.scope.dispose();
    }
}
