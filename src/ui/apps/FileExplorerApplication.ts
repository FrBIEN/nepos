import { importFile } from './FileOperations';
import { HostApplication } from './HostApplication';
import { glyph } from '../Glyphs';
import { escapeHTML } from '../html';
export class FileExplorerApplication extends HostApplication {
    mount(): void { this.element.innerHTML = this.createFileExplorerUI(); this.setupFileExplorer(this.element); }
    private createFileExplorerUI(): string {
        return `
      <div style="display: flex; flex-direction: column; height: 100%; color: var(--text-primary);">
        <!-- Toolbar -->
        <div style="padding: 8px; border-bottom: 1px solid var(--border-color); display: flex; gap: 8px; align-items: center; background: var(--bg-secondary);">
          <div style="display: flex; gap: 8px; align-items: center; flex: 1;">
            <button class="btn btn-sm btn-secondary" id="explorer-up" title="Nach oben">${glyph('up')}</button>
            <input class="form-control" type="text" id="explorer-path" value="/" style="flex: 1; min-width: 0; padding: 4px 8px; border: 1px solid var(--border-color); border-radius: 4px; font-family: monospace;" readonly>
            <button class="btn btn-sm btn-secondary" id="explorer-refresh" title="Aktualisieren">${glyph('refresh')}</button>
          </div>

        </div>

        <!-- Actions -->
        <div class="explorer-actions" style="padding: 8px; border-bottom: 1px solid var(--border-color); background: var(--bg-tertiary);">
          <button class="btn btn-sm btn-secondary" id="explorer-new-file">${glyph('file')} Datei</button>
          <button class="btn btn-sm btn-secondary" id="explorer-new-folder">${glyph('fileexplorer')} Ordner</button>
          <button class="btn btn-sm btn-danger" id="explorer-delete" disabled>${glyph('delete')} Löschen</button>
          <button class="btn btn-sm btn-secondary" id="explorer-open" disabled>Öffnen</button>
          <button class="btn btn-sm btn-secondary" id="explorer-copy" disabled>${glyph('copy')} Kopieren</button>
          <button class="btn btn-sm btn-secondary" id="explorer-cut" disabled>${glyph('cut')} Ausschneiden</button>
          <button class="btn btn-sm btn-secondary" id="explorer-paste" disabled>${glyph('paste')} Einfügen</button>
          <button class="btn btn-sm btn-secondary" id="explorer-rename" disabled>${glyph('rename')} Umbenennen</button>
          <button class="btn btn-sm btn-secondary" id="explorer-download" disabled>Download</button>
          <button class="btn btn-sm btn-secondary" id="explorer-upload-btn" title="Datei hochladen">${glyph('upload')} Upload</button>
          <input type="file" id="explorer-upload-input" style="display: none;" multiple />
        </div>

        <!-- File List -->
        <div id="explorer-list" style="flex: 1; overflow-y: auto; padding: 8px; display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); grid-auto-rows: 100px; gap: 8px;">
        </div>

        <!-- Status Bar -->
        <div style="padding: 4px 8px; background: var(--bg-secondary); border-top: 1px solid var(--border-color); font-size: 0.75rem; color: var(--text-secondary);">
          <span id="explorer-status">Bereit</span>
        </div>
      </div>
    `;
    }
    private setupFileExplorer(content: HTMLElement): void {
        const fs = this.deps.hostFileSystemManager.getOrCreateFileSystem(this.host);
        const listContainer = content.querySelector('#explorer-list') as HTMLElement;
        const pathInput = content.querySelector('#explorer-path') as HTMLInputElement;
        const statusLabel = content.querySelector('#explorer-status') as HTMLElement;
        const deleteBtn = content.querySelector('#explorer-delete') as HTMLButtonElement;
        let currentPath = '/';
        let selectedFile: string | null = null;
        let clipboard: {
            path: string;
            move: boolean;
        } | null = null;
        const selectButtons = [...content.querySelectorAll<HTMLButtonElement>('#explorer-open,#explorer-copy,#explorer-cut,#explorer-rename,#explorer-download')];
        const updateActions = () => { selectButtons.forEach(b => b.disabled = !selectedFile); (content.querySelector('#explorer-download') as HTMLButtonElement).disabled = !selectedFile || !!fs.getStats(selectedFile)?.isDirectory; (content.querySelector('#explorer-paste') as HTMLButtonElement).disabled = !clipboard; };
        let listScope = this.scope.child();
        const renderList = () => {
            listScope.dispose(); listScope = this.scope.child();
            // Clear selection
            selectedFile = null;
            deleteBtn.disabled = true;
            updateActions();
            statusLabel.textContent = `${currentPath}`;
            const children = fs.readdir(currentPath);
            if (!children) {
                listContainer.innerHTML = '<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: var(--text-muted);">Verzeichnis nicht gefunden.</div>';
                return;
            }
            pathInput.value = currentPath;
            if (children.length === 0) {
                listContainer.innerHTML = '<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: var(--text-muted);">Dieser Ordner ist leer.</div>';
                return;
            }
            listContainer.innerHTML = children.map(name => {
                const fullPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
                const stats = fs.getStats(fullPath);
                const isDir = stats?.isDirectory;
                const icon = glyph(isDir ? 'fileexplorer' : /\.(png|jpe?g|gif|webp)$/i.test(name) ? 'imageviewer' : 'file');
                const colorStyle = 'color: var(--text-primary);'; // Explicitly set color for dark mode handling
                return `
          <div class="explorer-item" role="button" tabindex="0" data-name="${escapeHTML(name)}" data-path="${escapeHTML(fullPath)}" data-type="${isDir ? 'dir' : 'file'}"
               style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px; border-radius: 4px; border: 1px solid transparent; cursor: pointer; text-align: center; ${colorStyle}">
            <div style="font-size: 2.5rem; margin-bottom: 4px; text-shadow: 0 1px 3px rgba(0,0,0,0.3);">${icon}</div>
            <div style="font-size: 0.8rem; word-break: break-all; line-height: 1.2;">${escapeHTML(name)}</div>
          </div>
        `;
            }).join('');
            // Add listeners
            listContainer.querySelectorAll('.explorer-item').forEach(item => {
                const el = item as HTMLElement;
                const path = el.dataset.path!;
                const type = el.dataset.type!;
                listScope.listen(el, 'keydown', e => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                    }
                    else if (e.key === ' ') {
                        e.preventDefault();
                        el.click();
                    }
                });
                // Select (Single Click)
                listScope.listen(el, 'click', (e) => {
                    // Deselect all
                    listContainer.querySelectorAll('.explorer-item').forEach(i => {
                        (i as HTMLElement).style.backgroundColor = '';
                        (i as HTMLElement).style.borderColor = 'transparent';
                    });
                    // Select this
                    selectedFile = path;
                    el.style.backgroundColor = 'rgba(100, 149, 237, 0.3)'; // Better visibility on dark/light
                    el.style.borderColor = 'var(--primary)';
                    deleteBtn.disabled = false;
                    updateActions();
                    statusLabel.textContent = `Ausgewählt: ${path}`;
                    e.stopPropagation();
                });
                // Open (Double Click)
                listScope.listen(el, 'dblclick', () => {
                    if (type === 'dir') {
                        currentPath = path;
                        renderList();
                    }
                    else {
                        // Binary Check - Image opening
                        const fileName = el.dataset.name!;
                        if (fileName.match(/\.(jpg|jpeg|png|gif|bmp|webp|ico)$/i)) {
                            void this.launchApp('imageviewer', { path });
                            return;
                        }
                        if (fs.isBinary(path)) {
                            void this.showNotice('Diese Binärdatei kann heruntergeladen werden.');
                            return;
                        }
                        // Pass the selected path directly to the editor.
                        void this.launchApp('texteditor', { path });
                    }
                });
            });
        };
        // Initial render
        renderList();
        // Background click deselects
        this.scope.listen(listContainer, 'click', () => {
            listContainer.querySelectorAll('.explorer-item').forEach(i => {
                (i as HTMLElement).style.backgroundColor = '';
                (i as HTMLElement).style.borderColor = 'transparent';
            });
            selectedFile = null;
            deleteBtn.disabled = true;
            updateActions();
            statusLabel.textContent = `${currentPath}`;
        });
        // Navigation
        this.scope.listen(content.querySelector('#explorer-up'), 'click', () => {
            if (currentPath !== '/') {
                const parts = currentPath.split('/');
                parts.pop();
                currentPath = parts.length === 1 && parts[0] === '' ? '/' : parts.join('/');
                renderList();
            }
        });
        this.scope.listen(content.querySelector('#explorer-refresh'), 'click', renderList);
        // Creating an entry never silently truncates an existing file.
        const createEntry = async (directory: boolean) => {
            const path = currentPath;
            const name = await this.askText(directory ? 'Name des neuen Ordners:' : 'Name der neuen Datei (z.B. test.txt):');
            if (name === null || this.scope.disposed) return;
            if (!name.trim() || name.includes('/') || name.includes('\\') || name.includes('\0') || name === '.' || name === '..') {
                await this.showNotice('Bitte einen gültigen Namen ohne Pfadtrenner eingeben.'); return;
            }
            const parent = fs.resolveNode(path);
            if (!parent || fs.exists(name, parent)) {
                await this.showNotice('Dieser Name ist bereits vorhanden oder der Ordner existiert nicht mehr.'); return;
            }
            if (!(directory ? fs.mkdir(name, parent) : fs.writeFile(name, '', parent))) {
                await this.showNotice('Der Eintrag konnte nicht angelegt werden.'); return;
            }
            renderList();
        };
        this.scope.listen(content.querySelector('#explorer-new-folder'), 'click', () => { void createEntry(true); });
        this.scope.listen(content.querySelector('#explorer-new-file'), 'click', () => { void createEntry(false); });
        this.scope.listen(deleteBtn, 'click', async () => {
            if (selectedFile && await this.askConfirm(`"${selectedFile}" wirklich löschen?`)) {
                fs.delete(selectedFile); // Delete supports absolute path
                renderList();
            }
        });
        this.scope.listen(content.querySelector('#explorer-open'), 'click', () => {
            const item = [...listContainer.querySelectorAll<HTMLElement>('.explorer-item')].find(item => item.dataset.path === selectedFile);
            item?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        });
        for (const action of ['copy', 'cut'])
            this.scope.listen(content.querySelector(`#explorer-${action}`), 'click', () => {
                if (selectedFile) {
                    clipboard = { path: selectedFile, move: action === 'cut' };
                    updateActions();
                    statusLabel.textContent = `${action === 'cut' ? 'Ausschneiden' : 'Kopieren'}: ${selectedFile}`;
                }
            });
        let transferring = false;
        const transfer = async (source: string, target: string, move: boolean) => {
            if (transferring) return;
            transferring = true;
            try {
                const original = fs.resolveNode(source), existing = fs.resolveNode(target);
                if (!original || existing === original) return;
                if (existing?.isDirectory) { await this.showNotice('Dieser Name ist bereits durch einen Ordner belegt.'); return; }
                if (existing && !await this.askConfirm(`„${target}“ ist bereits vorhanden. Datei ersetzen?`)) return;
                if (this.scope.disposed || fs.resolveNode(source) !== original || fs.resolveNode(target) !== existing) return;
                if (!fs.transfer(source, target, move, undefined, !!existing)) { await this.showNotice('Kopieren oder Verschieben fehlgeschlagen.'); return; }
                if (move) clipboard = null;
                renderList();
            } finally { transferring = false; }
        };
        this.scope.listen(content.querySelector('#explorer-paste'), 'click', () => {
            if (clipboard) void transfer(clipboard.path, `${currentPath === '/' ? '' : currentPath}/${clipboard.path.split('/').at(-1)}`, clipboard.move);
        });
        this.scope.listen(content.querySelector('#explorer-rename'), 'click', async () => {
            const source = selectedFile, parent = currentPath;
            if (!source) return;
            const name = await this.askText('Neuer Name:', source.split('/').at(-1));
            if (name === null || this.scope.disposed) return;
            if (!name.trim() || /[\\/\0]/.test(name) || ['.', '..'].includes(name)) { await this.showNotice('Bitte einen gültigen Namen ohne Pfadtrenner eingeben.'); return; }
            await transfer(source, `${parent === '/' ? '' : parent}/${name}`, true);
        });
        this.scope.listen(content.querySelector('#explorer-download'), 'click', () => {
            if (!selectedFile) return;
            const bytes = fs.readBytes(selectedFile), node = fs.resolveNode(selectedFile);
            if (!bytes || !node) return;
            const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type: node.mimeType || 'application/octet-stream'}));
            const link = document.createElement('a'); link.href = url; link.download = node.name; link.click();
            const release = this.scope.add(() => URL.revokeObjectURL(url));
            this.scope.timeout(() => { URL.revokeObjectURL(url); release(); }, 1000);
        });
        // Real Upload
        const uploadBtn = content.querySelector('#explorer-upload-btn') as HTMLButtonElement;
        const uploadInput = content.querySelector('#explorer-upload-input') as HTMLInputElement;
        this.scope.listen(uploadBtn, 'click', () => {
            uploadInput.click();
        });
        let uploading = false;
        this.scope.listen(uploadInput, 'change', async () => {
            const files = Array.from(uploadInput.files ?? []), directory = currentPath;
            uploadInput.value = '';
            if (uploading) return;
            uploading = true;
            try {
                for (const file of files) {
                    if (this.scope.disposed) break;
                    const path = `${directory === '/' ? '' : directory}/${file.name}`;
                    if (await importFile(fs, path, file, this.scope.signal, message => this.askConfirm(message)) && !this.scope.disposed) renderList();
                }
            } catch (error) { if (!this.scope.disposed) await this.showNotice(error instanceof Error ? error.message : String(error)); }
            finally { uploading = false; }
        });
    }
}
