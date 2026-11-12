import { eventBus, Events, type EventBus } from '../core/EventBus';
export interface EditorTab { path: string | null; name: string; content: string; isDirty: boolean }
export interface EditorSession { hostId: string; tabs: EditorTab[]; activeTabIndex: number }
/** Unsaved text belongs to the project, including recovery after a browser reload. */
export function createEditorSessions(events: EventBus = eventBus) { return {
    sessions: new Map<string, EditorSession>(),
    get(hostId: string): EditorSession | undefined {
        const session = this.sessions.get(hostId); return session && structuredClone(session);
    },
    set(hostId: string, tabs: EditorTab[], activeTabIndex: number): void {
        if (tabs.some(tab => tab.isDirty)) this.sessions.set(hostId, structuredClone({hostId, tabs, activeTabIndex}));
        else this.sessions.delete(hostId);
        events.emit(Events.SERVICE_STATE_CHANGED, {type: 'editor'});
    },
    restore(sessions: EditorSession[] = []): void {
        this.sessions = new Map(sessions.map(session => [session.hostId, structuredClone(session)]));
    }
}; }
export type EditorSessions = ReturnType<typeof createEditorSessions>;
export const editorSessions = createEditorSessions();
