import type { FileSystem } from '../../apps/FileSystem';

/** A closed view or replaced parent can never receive a late upload. */
export async function importFile(fs: FileSystem, path: string, file: File, signal: AbortSignal, confirm: (message: string) => Promise<boolean>): Promise<boolean> {
    if (!file.name.trim() || /[\\/\0]/.test(file.name) || ['.', '..'].includes(file.name)) throw new Error('Ungültiger Dateiname');
    const parent = fs.resolveNode(path.slice(0, path.lastIndexOf('/')) || '/');
    if (signal.aborted || !parent?.isDirectory) return false;
    if (file.size > 16 * 1024 * 1024) throw new Error('Dateien dürfen höchstens 16 MiB groß sein.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (signal.aborted || fs.resolveNode(fs.getAbsolutePath(parent)) !== parent) return false;
    const existing = fs.resolveNode(path);
    if (existing?.isDirectory) throw new Error('Dieser Name ist bereits durch einen Ordner belegt.');
    if (existing && !await confirm(`„${path}“ ist bereits vorhanden. Datei ersetzen?`)) return false;
    if (signal.aborted || fs.resolveNode(path) !== existing || fs.resolveNode(fs.getAbsolutePath(parent)) !== parent) return false;
    const mime = /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : 'application/octet-stream';
    if (!fs.writeBytes(path, bytes, mime, undefined, !!existing)) throw new Error('Datei konnte nicht gespeichert werden.');
    return true;
}
