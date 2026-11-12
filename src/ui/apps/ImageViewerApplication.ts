import { HostApplication } from './HostApplication';
import { escapeHTML } from '../html';
export class ImageViewerApplication extends HostApplication {
    mount(): void { this.element.innerHTML = this.createImageViewerUI(); this.setupImageViewer(this.element); }
    private createImageViewerUI(): string {
        return `
        <div style="display: flex; flex-direction: column; height: 100%;">
            <div style="padding: 8px; background: var(--bg-tertiary); border-bottom: 1px solid var(--border-color); display: flex; gap: 8px; align-items: center;">
                <button class="btn btn-sm btn-secondary" id="iv-open">Öffnen...</button>
                <div style="width: 1px; background: var(--border-color); margin: 0 4px;"></div>
                <span id="iv-filename" style="font-weight: 500; font-size: 0.9rem; margin-left: 8px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Kein Bild ausgewählt</span>

            </div>
            <div style="flex: 1; display: flex; align-items: center; justify-content: center; background: #000; overflow: hidden; position: relative;">
                <img id="iv-image" style="max-width: 100%; max-height: 100%; object-fit: contain; display: none;">
                <div id="iv-placeholder" style="color: #666;">Kein Bild geladen</div>

                <!-- Open File Dialog Overlay -->
                <div id="iv-dialog" style="display: none; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); align-items: center; justify-content: center; z-index: 10; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                    <div style="background: var(--bg-primary); width: 400px; max-width: 90%; border-radius: 6px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); display: flex; flex-direction: column; max-height: 80%; border: 1px solid var(--border-color); color: var(--text-primary);">
                        <div id="iv-dialog-title" style="padding: 10px 12px; border-bottom: 1px solid var(--border-color); font-weight: 600;">Bild öffnen</div>

                        <!-- Dialog Nav -->
                         <div style="padding: 6px 12px; border-bottom: 1px solid var(--border-color); display: flex; gap: 6px; background: var(--bg-tertiary); align-items: center;">
                            <button class="btn btn-xs btn-secondary" id="iv-dlg-up">⬆</button>
                            <input type="text" id="iv-dlg-path" value="/" readonly style="flex: 1; padding: 4px; font-size: 0.8rem; font-family: monospace;">
                        </div>

                        <!-- File List -->
                        <div id="iv-file-list" style="flex: 1; overflow-y: auto; height: 250px; padding: 4px; background: var(--bg-secondary);"></div>

                        <!-- Buttons -->
                        <div style="padding: 10px 12px; border-top: 1px solid var(--border-color); text-align: right; display: flex; justify-content: flex-end; gap: 8px;">
                            <button class="btn btn-sm btn-secondary" id="iv-dialog-cancel">Abbrechen</button>
                            <button class="btn btn-sm btn-primary" id="iv-dialog-action">Öffnen</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
      `;
    }
    private setupImageViewer(content: HTMLElement): void {
        const fs = this.deps.hostFileSystemManager.getOrCreateFileSystem(this.host);
        const filenameLabel = content.querySelector('#iv-filename') as HTMLElement;
        const imgElement = content.querySelector('#iv-image') as HTMLImageElement;
        const placeholder = content.querySelector('#iv-placeholder') as HTMLElement;
        // Dialog Elements
        const openBtn = content.querySelector('#iv-open') as HTMLButtonElement;
        const dialogRoot = content.querySelector('#iv-dialog') as HTMLElement;
        const dlgList = content.querySelector('#iv-file-list') as HTMLElement;
        const dlgPathInput = content.querySelector('#iv-dlg-path') as HTMLInputElement;
        const dlgUpBtn = content.querySelector('#iv-dlg-up') as HTMLButtonElement;
        const dlgCancelBtn = content.querySelector('#iv-dialog-cancel') as HTMLButtonElement;
        const dlgActionBtn = content.querySelector('#iv-dialog-action') as HTMLButtonElement;
        let dlgCurrentPath = '/';
        let dlgSelectedFile: string | null = null;
        // Helper to load image
        const loadImage = (path: string) => {
            if (fs.exists(path)) {
                const content = fs.readFile(path);
                if (content && content.startsWith('data:')) {
                    imgElement.src = content;
                    imgElement.style.display = 'block';
                    placeholder.style.display = 'none';
                    filenameLabel.textContent = path.split('/').pop() || path;
                }
                else {
                    placeholder.textContent = 'Fehler: Ungültiges Bildformat oder keine Daten.';
                    filenameLabel.textContent = path;
                    imgElement.style.display = 'none';
                    placeholder.style.display = 'block';
                }
            }
            else {
                placeholder.textContent = 'Fehler: Datei nicht gefunden.';
                imgElement.style.display = 'none';
                placeholder.style.display = 'block';
            }
        };
        // Handle Back
        // Load file from "intent"
        const pendingFile = this.context.request.path;
        if (pendingFile) {
            loadImage(pendingFile);
        }
        // --- Dialog Logic ---
        const renderDialogList = () => {
            dlgPathInput.value = dlgCurrentPath;
            const children = fs.readdir(dlgCurrentPath);
            if (!children || children.length === 0) {
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
                const icon = isDir ? '📁' : (name.match(/\.(jpg|jpeg|png|gif|bmp|webp|ico)$/i) ? '🖼️' : '📄');
                // Dim non-image files
                const isImage = name.match(/\.(jpg|jpeg|png|gif|bmp|webp|ico)$/i);
                const opacity = isDir || isImage ? '1' : '0.5';
                return `
                    <div class="dlg-item" data-path="${escapeHTML(fullPath)}" data-type="${isDir ? 'dir' : 'file'}" data-name="${escapeHTML(name)}"
                         style="padding: 6px 8px; cursor: pointer; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 8px; opacity: ${opacity};">
                        <span>${icon}</span>
                        <span>${escapeHTML(name)}</span>
                    </div>
                `;
            }).join('');
            // Listeners
            dlgList.querySelectorAll('.dlg-item').forEach(el => {
                this.scope.listen(el, 'click', () => {
                    dlgList.querySelectorAll('.dlg-item').forEach(i => (i as HTMLElement).style.background = 'transparent');
                    (el as HTMLElement).style.background = 'rgba(0,120,215,0.1)';
                    const type = (el as HTMLElement).dataset.type;
                    const path = (el as HTMLElement).dataset.path!;
                    if (type === 'file') {
                        dlgSelectedFile = path;
                    }
                });
                this.scope.listen(el, 'dblclick', () => {
                    const type = (el as HTMLElement).dataset.type;
                    const path = (el as HTMLElement).dataset.path!;
                    if (type === 'dir') {
                        dlgCurrentPath = path;
                        renderDialogList();
                    }
                    else {
                        // Check extension
                        if (path.match(/\.(jpg|jpeg|png|gif|bmp|webp|ico)$/i)) {
                            loadImage(path);
                            closeDialog();
                        }
                    }
                });
            });
        };
        const closeDialog = () => {
            dialogRoot.style.display = 'none';
        };
        this.scope.listen(openBtn, 'click', () => {
            dlgCurrentPath = '/';
            dlgSelectedFile = null;
            dialogRoot.style.display = 'flex';
            renderDialogList();
        });
        this.scope.listen(dlgUpBtn, 'click', () => {
            if (dlgCurrentPath !== '/') {
                const parts = dlgCurrentPath.split('/');
                parts.pop();
                dlgCurrentPath = parts.length === 1 && parts[0] === '' ? '/' : parts.join('/');
                renderDialogList();
            }
        });
        this.scope.listen(dlgCancelBtn, 'click', closeDialog);
        this.scope.listen(dlgActionBtn, 'click', () => {
            if (dlgSelectedFile) {
                if (dlgSelectedFile.match(/\.(jpg|jpeg|png|gif|bmp|webp|ico)$/i)) {
                    loadImage(dlgSelectedFile);
                    closeDialog();
                }
                else {
                    void this.showNotice('Bitte wähle eine Bilddatei aus.');
                }
            }
        });
    }
}
