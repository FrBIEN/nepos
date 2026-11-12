import { showNotice } from '../Dialogs';
import type { ApplicationContext } from '../../application/ApplicationContext';
import type { Host, Knoten, Kabel } from '../../hardware';
import { Lifetime } from '../../core/Lifetime';
export interface InspectorContext {
    dependencies: ApplicationContext;
    isSimulation: () => boolean;
    nodes: () => Knoten[];
    openDesktop: (host: Host) => void;
    refresh: (node: Knoten) => void;
    changed: () => void;
    deleteCable: (cable: Kabel) => void;
}
export abstract class Inspector {
    protected scope = new Lifetime();
    constructor(protected context: InspectorContext) { }
    protected showNotice(message: string) { return showNotice(message, this.scope.signal); }
    abstract render(device: Knoten, content: HTMLElement): void;
    dispose(): void { this.scope.dispose(); }
}
