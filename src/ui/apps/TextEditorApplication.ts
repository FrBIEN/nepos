import { HostApplication } from './HostApplication';
import { type EditorTab } from '../../apps/EditorSessions';
import { escapeHTML } from '../html';
export class TextEditorApplication extends HostApplication {
    mount(): void { this.element.innerHTML = this.createTextEditorUI(); this.setupTextEditor(this.element); }
    private createTextEditorUI(): string {
        return `
      <div style="display: flex; flex-direction: column; height: 100%;">
        <!-- Toolbar -->
        <div style="padding: 4px; background: var(--bg-tertiary); border-bottom: 1px solid var(--border-color); display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
            <button class="btn btn-sm btn-secondary" id="te-new">Neu</button>
            <button class="btn btn-sm btn-secondary" id="te-open">Öffnen...</button>
            <button class="btn btn-sm btn-primary" id="te-save" disabled>Speichern</button>
            <button class="btn btn-sm btn-secondary" id="te-save-as">Speichern unter...</button>
            <div style="flex: 1;"></div>

        </div>

        <!-- Tab Bar -->
        <div id="te-tabs" style="display: flex; background: var(--bg-secondary); border-bottom: 1px solid var(--border-color); overflow-x: auto;">
           <!-- Tabs go here -->
        </div>

        <!-- Editor Area -->
        <div style="position: relative; flex: 1; display: flex;">
            <textarea id="te-editor" disabled
                style="flex: 1; resize: none; border: none; padding: 12px; font-family: 'Monaco', 'Consolas', monospace; font-size: 13px; line-height: 1.5; background: var(--bg-primary); color: var(--text-primary); outline: none;"
                placeholder="Keine Datei geöffnet."></textarea>

            <!-- Shared File Dialog Overlay -->
            <div id="te-dialog" style="display: none; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); align-items: center; justify-content: center; z-index: 10;">
                <div style="background: var(--bg-primary); width: 400px; max-width: 90%; border-radius: 6px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); display: flex; flex-direction: column; max-height: 80%; border: 1px solid var(--border-color);">
                    <div id="te-dialog-title" style="padding: 10px 12px; border-bottom: 1px solid var(--border-color); font-weight: 600;">Datei öffnen</div>

                    <!-- Dialog Nav -->
                     <div style="padding: 6px 12px; border-bottom: 1px solid var(--border-color); display: flex; gap: 6px; background: var(--bg-tertiary); align-items: center;">
                        <button class="btn btn-xs btn-secondary" id="te-dlg-up">⬆</button>
                        <input type="text" id="te-dlg-path" value="/" readonly style="flex: 1; padding: 4px; font-size: 0.8rem; font-family: monospace;">
                    </div>

                    <!-- File List -->
                    <div id="te-file-list" style="flex: 1; overflow-y: auto; height: 250px; padding: 4px; background: var(--bg-secondary);"></div>

                    <!-- Save As specific -->
                    <div id="te-save-input-area" style="padding: 8px 12px; border-top: 1px solid var(--border-color); display: none;">
                        <label style="font-size: 0.75rem; display: block; margin-bottom: 4px;">Dateiname:</label>
                        <input type="text" id="te-save-filename" class="form-control" placeholder="dateiname.txt" style="width: 100%;">
                    </div>

                    <!-- Buttons -->
                    <div style="padding: 10px 12px; border-top: 1px solid var(--border-color); text-align: right; display: flex; justify-content: flex-end; gap: 8px;">
                        <button class="btn btn-sm btn-secondary" id="te-dialog-cancel">Abbrechen</button>
                        <button class="btn btn-sm btn-primary" id="te-dialog-action">Öffnen</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Status Bar -->
        <div style="padding: 2px 8px; background: var(--bg-secondary); border-top: 1px solid var(--border-color); font-size: 0.75rem; color: var(--text-secondary); display: flex; justify-content: space-between;">
          <span id="te-status">Bereit</span>
          <span id="te-cursor">Ln 1, Col 1</span>
        </div>
      </div>
    `;
    }
    private setupTextEditor(content: HTMLElement): void {
        const fs = this.deps.hostFileSystemManager.getOrCreateFileSystem(this.host);
        const editor = content.querySelector('#te-editor') as HTMLTextAreaElement;
        const tabsContainer = content.querySelector('#te-tabs') as HTMLElement;
        const saveBtn = content.querySelector('#te-save') as HTMLButtonElement;
        const saveAsBtn = content.querySelector('#te-save-as') as HTMLButtonElement;
        const statusLabel = content.querySelector('#te-status') as HTMLElement;
        const cursorLabel = content.querySelector('#te-cursor') as HTMLElement;
        // Dialog Elements
        const dialogRoot = content.querySelector('#te-dialog') as HTMLElement;
        const dlgTitle = content.querySelector('#te-dialog-title') as HTMLElement;
        const dlgList = content.querySelector('#te-file-list') as HTMLElement;
        const dlgPathInput = content.querySelector('#te-dlg-path') as HTMLInputElement;
        const dlgUpBtn = content.querySelector('#te-dlg-up') as HTMLButtonElement;
        const dlgSaveArea = content.querySelector('#te-save-input-area') as HTMLElement;
        const dlgFilenameInput = content.querySelector('#te-save-filename') as HTMLInputElement;
        const dlgCancelBtn = content.querySelector('#te-dialog-cancel') as HTMLButtonElement;
        const dlgActionBtn = content.querySelector('#te-dialog-action') as HTMLButtonElement;
        // State
        const recovered = this.deps.editorSessions.get(this.host.getId());
        let tabs: EditorTab[] = recovered?.tabs ?? [];
        let activeTabIndex = -1;
        const persistDrafts = () => this.deps.editorSessions.set(this.host.getId(), tabs, activeTabIndex);
        // --- Tab Logic ---
        const renderTabs = () => {
            persistDrafts();
            tabsContainer.innerHTML = tabs.map((tab, index) => `
              <div class="te-tab ${index === activeTabIndex ? 'active' : ''}" data-index="${index}"
                   style="padding: 6px 12px; border-right: 1px solid var(--border-color); cursor: pointer; display: flex; align-items: center; gap: 8px; background: ${index === activeTabIndex ? 'var(--bg-primary)' : 'transparent'}; font-size: 0.85rem; user-select: none;">
                  <span style="${tab.isDirty ? 'font-style: italic;' : ''}">${escapeHTML(tab.name)}${tab.isDirty ? '*' : ''}</span>
                  <button type="button" class="te-close-tab btn" data-index="${index}" aria-label="${escapeHTML(tab.name)} schließen" style="min-width:44px;min-height:44px">✕</button>
              </div>
          `).join('');
            // Bind click to activate
            tabsContainer.querySelectorAll('.te-tab').forEach(el => {
                this.scope.listen(el, 'click', (e) => {
                    if ((e.target as HTMLElement).classList.contains('te-close-tab'))
                        return; // Handle close separately
                    setActiveTab(parseInt((el as HTMLElement).dataset.index!));
                });
            });
            // Bind close
            tabsContainer.querySelectorAll('.te-close-tab').forEach(el => {
                this.scope.listen(el, 'click', (e) => {
                    e.stopPropagation();
                    closeTab(parseInt((el as HTMLElement).dataset.index!));
                });
            });
        };
        const setActiveTab = (index: number) => {
            if (activeTabIndex !== -1 && tabs[activeTabIndex]) {
                // Save current content to tab state before switching
                tabs[activeTabIndex].content = editor.value;
            }
            if (index >= 0 && index < tabs.length) {
                activeTabIndex = index;
                const tab = tabs[index];
                editor.value = tab.content;
                editor.disabled = false;
                saveBtn.disabled = false;
                statusLabel.textContent = tab.path || 'Unbenannt';
            }
            else {
                activeTabIndex = -1;
                editor.value = '';
                editor.disabled = true;
                saveBtn.disabled = true;
                statusLabel.textContent = 'Bereit';
            }
            renderTabs();
        };
        const saveTab = async (index: number): Promise<boolean> => {
            const tab = tabs[index];
            if (index === activeTabIndex)
                tab.content = editor.value;
            const path = tab.path ?? await this.askText('Dateipfad zum Speichern:', '/' + tab.name + '.txt');
            if (path === null)
                return false;
            if (!path.trim() || path.endsWith('/') || (!tab.path && fs.exists(path) && !await this.askConfirm('Vorhandene Datei überschreiben?')))
                return false;
            if (fs.isBinary(path)) { await this.showNotice('Binärdateien können im Texteditor nicht überschrieben werden.'); return false; }
            if (!fs.writeFile(path, tab.content)) {
                await this.showNotice('Die Datei konnte nicht gespeichert werden. Prüfen Sie den Pfad.');
                return false;
            }
            tab.path = path;
            tab.name = path.split('/').pop()!;
            tab.isDirty = false;
            renderTabs();
            return true;
        };
        const resolveTab = async (index: number): Promise<boolean> => {
            if (!tabs[index].isDirty)
                return true;
            const action = await this.askSaveChanges('Änderungen an „' + tabs[index].name + '“ speichern?');
            if (action === 'save')
                return saveTab(index);
            return action === 'discard';
        };
        this.leaveGuard = async () => {
            for (let index = 0; index < tabs.length; index++)
                if (!await resolveTab(index))
                    return false;
            this.leaveCommit = () => this.deps.editorSessions.set(this.host.getId(), [], -1);
            return true;
        };
        const closeTab = async (index: number) => {
            if (!await resolveTab(index))
                return;
            const previousActive = activeTabIndex;
            if (tabs[previousActive])
                tabs[previousActive].content = editor.value;
            tabs.splice(index, 1);
            activeTabIndex = -1;
            if (tabs.length === 0) {
                setActiveTab(-1);
            }
            else {
                // Try to keep nearest tab active
                const newIndex = previousActive === index ? Math.min(index, tabs.length - 1) : previousActive > index ? previousActive - 1 : previousActive;
                setActiveTab(newIndex);
            }
        };
        const openFile = (path: string) => {
            if (fs.isBinary(path)) { void this.showNotice('Binärdateien können im Texteditor nicht bearbeitet werden.'); return; }
            // Check if already open
            const existing = tabs.findIndex(t => t.path === path);
            if (existing !== -1) {
                setActiveTab(existing);
                return;
            }
            const content = fs.readFile(path);
            if (content !== null) {
                const name = path.split('/').pop() || path;
                tabs.push({ path, name, content, isDirty: false });
                setActiveTab(tabs.length - 1);
            }
        };
        // File handoff is an explicit navigation request from the explorer.
        const pendingFile = this.context.request.path;
        if (recovered)
            setActiveTab(recovered.activeTabIndex);
        if (pendingFile) {
            openFile(pendingFile);
        }
        else {
            // Open empty if no tabs
            if (tabs.length === 0) {
                // Maybe start with a new untitled file
                tabs.push({ path: null, name: 'Unbenannt-1', content: '', isDirty: false });
                setActiveTab(0);
            }
        }
        // --- Dialog Logic ---
        let dialogMode: 'open' | 'save' = 'open';
        let dlgCurrentPath = '/';
        let dlgSelectedFile: string | null = null;
        const renderDialogList = () => {
            dlgPathInput.value = dlgCurrentPath;
            const children = fs.readdir(dlgCurrentPath);
            if (!children) {
                dlgList.innerHTML = '<div style="padding: 10px; color: var(--text-secondary);">Pfad nicht gefunden</div>';
                return;
            }
            if (children.length === 0) {
                dlgList.innerHTML = '<div style="padding: 10px; color: var(--text-secondary);">Ordner ist leer</div>';
                return;
            }
            // Sort: Directories first
            const sorted = children.slice().sort((a, b) => {
                const pathA = dlgCurrentPath === '/' ? `/${a}` : `${dlgCurrentPath}/${a}`;
                const pathB = dlgCurrentPath === '/' ? `/${b}` : `${dlgCurrentPath}/${b}`;
                const isDirA = fs.getStats(pathA)?.isDirectory;
                const isDirB = fs.getStats(pathB)?.isDirectory;
                if (isDirA && !isDirB)
                    return -1;
                if (!isDirA && isDirB)
                    return 1;
                return a.localeCompare(b);
            });
            dlgList.innerHTML = sorted.map(name => {
                const fullPath = dlgCurrentPath === '/' ? `/${name}` : `${dlgCurrentPath}/${name}`;
                const stats = fs.getStats(fullPath);
                const isDir = stats?.isDirectory;
                const icon = isDir ? '📁' : '📄';
                return `
                <div class="dlg-item" data-path="${escapeHTML(fullPath)}" data-type="${isDir ? 'dir' : 'file'}" data-name="${escapeHTML(name)}"
                     style="padding: 6px 8px; cursor: pointer; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 8px;">
                    <span>${icon}</span>
                    <span>${escapeHTML(name)}</span>
                </div>
            `;
            }).join('');
            // Listeners for list items
            dlgList.querySelectorAll('.dlg-item').forEach(el => {
                this.scope.listen(el, 'click', () => {
                    // Formatting active state
                    dlgList.querySelectorAll('.dlg-item').forEach(i => (i as HTMLElement).style.background = 'transparent');
                    (el as HTMLElement).style.background = 'rgba(0,120,215,0.1)';
                    const type = (el as HTMLElement).dataset.type;
                    const path = (el as HTMLElement).dataset.path!;
                    if (type === 'file') {
                        dlgSelectedFile = path;
                        if (dialogMode === 'save') {
                            dlgFilenameInput.value = (el as HTMLElement).dataset.name!;
                        }
                    }
                });
                this.scope.listen(el, 'dblclick', () => {
                    const type = (el as HTMLElement).dataset.type;
                    const path = (el as HTMLElement).dataset.path!;
                    if (type === 'dir') {
                        dlgCurrentPath = path;
                        renderDialogList();
                    }
                    else if (dialogMode === 'open') {
                        openFile(path);
                        closeDialog();
                    }
                });
            });
        };
        const openDialogFunc = () => {
            dialogMode = 'open';
            dlgTitle.textContent = 'Datei öffnen';
            dlgActionBtn.textContent = 'Öffnen';
            dlgSaveArea.style.display = 'none';
            dlgCurrentPath = '/';
            dialogRoot.style.display = 'flex';
            renderDialogList();
        };
        const saveAsDialogFunc = () => {
            dialogMode = 'save';
            dlgTitle.textContent = 'Speichern unter...';
            dlgActionBtn.textContent = 'Speichern';
            dlgSaveArea.style.display = 'block';
            dlgFilenameInput.value = (tabs[activeTabIndex]?.name || 'unbenannt.txt');
            dlgCurrentPath = '/';
            dialogRoot.style.display = 'flex';
            renderDialogList();
        };
        const closeDialog = () => {
            dialogRoot.style.display = 'none';
        };
        // Dialog Event Listeners
        this.scope.listen(dlgUpBtn, 'click', () => {
            if (dlgCurrentPath !== '/') {
                const parts = dlgCurrentPath.split('/');
                parts.pop();
                dlgCurrentPath = parts.length === 1 && parts[0] === '' ? '/' : parts.join('/');
                renderDialogList();
            }
        });
        this.scope.listen(dlgCancelBtn, 'click', closeDialog);
        this.scope.listen(dlgActionBtn, 'click', async () => {
            if (dialogMode === 'open') {
                if (dlgSelectedFile) {
                    openFile(dlgSelectedFile);
                    closeDialog();
                }
            }
            else {
                // Save
                const name = dlgFilenameInput.value.trim();
                if (name) {
                    const path = dlgCurrentPath === '/' ? `/${name}` : `${dlgCurrentPath}/${name}`;
                    // Save Logic
                    if (fs.exists(path) && tabs[activeTabIndex]?.path !== path && !await this.askConfirm('Vorhandene Datei überschreiben?'))
                        return;
                    if (fs.isBinary(path)) { await this.showNotice('Binärdateien können im Texteditor nicht überschrieben werden.'); return; }
                    if (!fs.writeFile(path, editor.value)) {
                        void this.showNotice('Datei konnte nicht gespeichert werden.');
                        return;
                    }
                    if (activeTabIndex !== -1) {
                        tabs[activeTabIndex].path = path;
                        tabs[activeTabIndex].name = name;
                        tabs[activeTabIndex].content = editor.value;
                        tabs[activeTabIndex].isDirty = false;
                        renderTabs();
                        statusLabel.textContent = path;
                    }
                    closeDialog();
                }
                else {
                    void this.showNotice('Bitte Dateinamen eingeben.');
                }
            }
        });
        // Event Listeners for Editor
        this.scope.listen(editor, 'input', () => {
            if (activeTabIndex !== -1) {
                const tab = tabs[activeTabIndex];
                if (!tab.isDirty) {
                    tab.isDirty = true;
                    renderTabs();
                }
                tab.content = editor.value; // Keep sync
                persistDrafts();
            }
            const val = editor.value.substr(0, editor.selectionStart);
            const lines = val.split('\n');
            cursorLabel.textContent = `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
        });
        // Save Button (Quick Save)
        this.scope.listen(saveBtn, 'click', () => {
            if (activeTabIndex === -1)
                return;
            const tab = tabs[activeTabIndex];
            if (tab.path) {
                if (fs.isBinary(tab.path)) { void this.showNotice('Binärdateien können im Texteditor nicht überschrieben werden.'); return; }
                if (!fs.writeFile(tab.path, editor.value)) {
                    void this.showNotice('Datei konnte nicht gespeichert werden.');
                    return;
                }
                tab.content = editor.value;
                tab.isDirty = false;
                renderTabs();
                saveBtn.textContent = '✓ Gespeichert';
                this.scope.timeout(() => saveBtn.textContent = 'Speichern', 1000);
            }
            else {
                saveAsDialogFunc();
            }
        });
        this.scope.listen(content.querySelector('#te-new'), 'click', () => {
            tabs.push({ path: null, name: `Unbenannt-${tabs.length + 1}`, content: '', isDirty: false });
            setActiveTab(tabs.length - 1);
        });
        this.scope.listen(content.querySelector('#te-open'), 'click', openDialogFunc);
        this.scope.listen(saveAsBtn, 'click', saveAsDialogFunc);
        // Shortcuts
        this.scope.listen(editor, 'keydown', (e) => {
            if (e.metaKey || e.ctrlKey) {
                if (e.key === 's') {
                    e.preventDefault();
                    saveBtn.click();
                }
            }
        });
    }
}
