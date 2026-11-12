import type { RuntimeDependencies } from '../runtime/RuntimeDependencies';
import { assertRuntimeOwner } from '../runtime/assertRuntimeOwner';
import { legacyRuntime } from '../runtime/LegacyRuntime';

import { Host } from '../hardware/Host';
import { Events } from '../core/EventBus';

export interface FileSystemNode {
    name: string;
    isDirectory: boolean;
    content?: string; // UTF-8 text, or a data URL when encoding is set
    encoding?: 'data-url';
    children?: Map<string, FileSystemNode>; // For directories
    parent?: FileSystemNode | null; // For traversal
    lastModified: Date;
    mimeType?: string; // For web files
}

export interface FileSystemStats {
    name: string;
    isDirectory: boolean;
    size: number;
    lastModified: Date;
}

/**
 * FileSystem - Virtual file system for a Host
 * Supports a hierarchical structure (directories and files)
 */
export class FileSystem {
    private get runtime() { return this.host?.runtime ?? legacyRuntime; }

    private root: FileSystemNode;
    private host: Host;

    constructor(host: Host) {
        this.host = host;
        this.root = this.createNode('', true);
        this.root.parent = null;
    }

    private createNode(name: string, isDirectory: boolean, content: string = ''): FileSystemNode {
        return {
            name,
            isDirectory,
            content: isDirectory ? undefined : content,
            children: isDirectory ? new Map() : undefined,
            lastModified: new Date(),
            mimeType: isDirectory ? undefined : 'text/plain'
        };
    }

    /**
     * Resolve a path to a node
     * @param path Absolute or relative path (if cwd provided)
     * @param cwd Current working directory (optional, defaults to root)
     */
    resolveNode(path: string, cwd: FileSystemNode = this.root): FileSystemNode | null {
        if (!path || path === '.') return cwd;

        let current: FileSystemNode;
        let parts: string[];

        if (path.startsWith('/')) {
            current = this.root;
            parts = path.split('/').filter(p => p.length > 0);
        } else {
            current = cwd;
            parts = path.split('/').filter(p => p.length > 0);
        }

        for (const part of parts) {
            if (part === '.') continue;
            if (part === '..') {
                if (current.parent) {
                    current = current.parent;
                }
                continue;
            }

            if (!current.isDirectory || !current.children) return null;

            const next = current.children.get(part);
            if (!next) return null;
            current = next;
        }

        return current;
    }

    getRoot(): FileSystemNode {
        return this.root;
    }

    /**
     * Get file content
     */
    readFile(path: string, cwd?: FileSystemNode): string | null {
        const node = this.resolveNode(path, cwd);
        if (node && !node.isDirectory) {
            return node.content || '';
        }
        return null;
    }

    /**
     * Write file content (creates file if not exists, but not parent directories)
     */
    writeFile(path: string, content: string, cwd?: FileSystemNode, notify = true): boolean {
        // Separate filename from directory path
        const lastSlash = path.lastIndexOf('/');
        let dirPath = '';
        let fileName = path;

        if (lastSlash >= 0) {
            dirPath = path.substring(0, lastSlash);
            fileName = path.substring(lastSlash + 1);
            if (dirPath === '') dirPath = '/'; // Root
        } else {
            // Relative to CWD, so dirPath is empty/current
            dirPath = '.';
        }

        const dirNode = this.resolveNode(dirPath, cwd);
        if (!dirNode || !dirNode.isDirectory || !dirNode.children) return false;

        if (!fileName || fileName === '.' || fileName === '..' || fileName.includes('\0')) return false;
        let node = dirNode.children.get(fileName);
        if (node) {
            if (node.isDirectory) return false; // Cannot overwrite directory with file
            node.content = content;
            delete node.encoding;
            node.lastModified = new Date();
        } else {
            node = this.createNode(fileName, false, content);
            node.parent = dirNode;
            dirNode.children.set(fileName, node);
        }
        if (notify) this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'filesystem', hostId: this.host.getId() });
        return true;
    }

    /** Imported bytes retain their exact representation, including BOM and invalid UTF-8. */
    writeBytes(path: string, bytes: Uint8Array, mimeType = 'application/octet-stream', cwd?: FileSystemNode, overwrite = false): boolean {
        if (bytes.byteLength > 16 * 1024 * 1024 || !/^[\w.+-]+\/[\w.+-]+$/.test(mimeType)) return false;
        if (!overwrite && this.exists(path, cwd)) return false;
        let text: string | undefined;
        if (/^(text\/|application\/(json|javascript|xml))/.test(mimeType) || /\.(txt|html?|css|js|json|xml|csv|md|svg)$/i.test(path)) {
            try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); if (text.includes('\0')) text = undefined; } catch { /* Binary bytes remain binary. */ }
        }
        let content = text;
        if (content === undefined) {
            let binary = '';
            for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
            content = `data:${mimeType};base64,${btoa(binary)}`;
        }
        if (!this.writeFile(path, content, cwd, false)) return false;
        const node = this.resolveNode(path, cwd)!;
        node.mimeType = mimeType;
        if (text === undefined) node.encoding = 'data-url';
        this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'filesystem', hostId: this.host.getId() });
        return true;
    }

    isBinary(path: string, cwd?: FileSystemNode): boolean {
        const node = this.resolveNode(path, cwd);
        return !!node && (node.encoding === 'data-url' || /^data:image\/[\w.+-]+;base64,/.test(node.content ?? ''));
    }

    readBytes(path: string, cwd?: FileSystemNode): Uint8Array | null {
        const node = this.resolveNode(path, cwd);
        if (!node || node.isDirectory) return null;
        if (!this.isBinary(path, cwd)) return new TextEncoder().encode(node.content ?? '');
        const content = node.content ?? '', comma = content.indexOf(',');
        try { return Uint8Array.from(atob(content.slice(comma + 1)), char => char.charCodeAt(0)); } catch { return null; }
    }

    touch(path: string, cwd?: FileSystemNode): boolean {
        const node = this.resolveNode(path,cwd); if (!node) return this.writeFile(path,'',cwd);
        node.lastModified = new Date(); this.runtime.events.emit(Events.SERVICE_STATE_CHANGED,{type:'filesystem',hostId:this.host.getId()}); return true;
    }

    /**
     * Append content to file
     */
    appendFile(path: string, content: string, cwd?: FileSystemNode): boolean {
        const node = this.resolveNode(path, cwd);
        if (node && !node.isDirectory && !this.isBinary(path, cwd)) {
            node.content = (node.content || '') + content;
            node.lastModified = new Date();
            this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'filesystem', hostId: this.host.getId() });
            return true;
        }
        return false;
    }

    /**
     * Create directory
     */
    mkdir(path: string, cwd?: FileSystemNode): boolean {
        // Separate dirname from parent path
        // We only support creating one level at a time for simplicity (like mkdir without -p)
        // actually let's support robust path resolution to the parent

        // Remove trailing slash
        if (path.endsWith('/') && path.length > 1) path = path.slice(0, -1);

        const lastSlash = path.lastIndexOf('/');
        let parentPath = '';
        let dirName = path;

        if (lastSlash >= 0) {
            parentPath = path.substring(0, lastSlash);
            dirName = path.substring(lastSlash + 1);
            if (parentPath === '') parentPath = '/';
        } else {
            parentPath = '.';
        }

        const parentNode = this.resolveNode(parentPath, cwd);
        if (!parentNode || !parentNode.isDirectory || !parentNode.children) return false;

        if (!dirName || dirName === '.' || dirName === '..' || dirName.includes('\0')) return false;
        if (parentNode.children.has(dirName)) return false; // Already exists

        const newNode = this.createNode(dirName, true);
        newNode.parent = parentNode;
        parentNode.children.set(dirName, newNode);
        this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'filesystem', hostId: this.host.getId() });
        return true;
    }

    /**
     * Delete file or directory (must be empty if directory)
     * @param recursive If true, deletes non-empty directories
     */
    delete(path: string, recursive: boolean = false, cwd?: FileSystemNode): boolean {
        const node = this.resolveNode(path, cwd);
        if (!node || !node.parent || !node.parent.children) return false; // Cannot delete root or not found

        if (node.isDirectory && node.children && node.children.size > 0 && !recursive) {
            return false; // Directory not empty
        }

        node.parent.children.delete(node.name);
        this.runtime.events.emit(Events.SERVICE_STATE_CHANGED, { type: 'filesystem', hostId: this.host.getId() });
        return true;
    }

    /** Copy/move actual files and subtrees, rejecting cycles and destructive directory replacement. */
    transfer(source: string, destination: string, move = false, cwd?: FileSystemNode, overwrite = false): boolean {
        const node=this.resolveNode(source,cwd);if(!node?.parent)return false;
        let target=this.resolveNode(destination,cwd),parent: FileSystemNode|null,name: string;
        if(target?.isDirectory){parent=target;name=node.name;target=target.children?.get(name)||null;}
        else {const slash=destination.lastIndexOf('/');parent=this.resolveNode(slash<0?'.':destination.slice(0,slash)||'/',cwd);name=destination.slice(slash+1);}
        if(!parent?.isDirectory||!parent.children||!name||['.','..'].includes(name)||name.includes('\0')||target===node||target?.isDirectory||!!target&&!overwrite)return false;
        for(let ancestor:FileSystemNode|null|undefined=parent;ancestor;ancestor=ancestor.parent)if(ancestor===node)return false;
        const clone=(original:FileSystemNode):FileSystemNode=>{
            const copied=this.createNode(original.name,original.isDirectory);copied.content=original.content;copied.mimeType=original.mimeType;copied.encoding=original.encoding;
            if(original.children)for(const [name,child] of original.children){const copy=clone(child);copy.parent=copied;copied.children!.set(name,copy);}return copied;
        };
        const copy=move?node:clone(node);if(move)node.parent.children!.delete(node.name);
        copy.name=name;copy.parent=parent;copy.lastModified=new Date();parent.children.set(name,copy);
        this.runtime.events.emit(Events.SERVICE_STATE_CHANGED,{hostId:this.host.getId(),type:'filesystem'});return true;
    }

    /**
     * Check if path exists
     */
    exists(path: string, cwd?: FileSystemNode): boolean {
        return this.resolveNode(path, cwd) !== null;
    }

    /**
     * Get stats for a path
     */
    getStats(path: string, cwd?: FileSystemNode): FileSystemStats | null {
        const node = this.resolveNode(path, cwd);
        if (!node) return null;
        return {
            name: node.name,
            isDirectory: node.isDirectory,
            size: node.isDirectory ? (node.children?.size || 0) : (this.readBytes(path, cwd)?.byteLength ?? 0),
            lastModified: node.lastModified
        };
    }

    /**
     * List directory contents
     */
    readdir(path: string, cwd?: FileSystemNode): string[] | null {
        const node = this.resolveNode(path, cwd);
        if (!node || !node.isDirectory || !node.children) return null;
        return Array.from(node.children.keys()).sort();
    }

    /**
     * Get absolute path of a node
     */
    getAbsolutePath(node: FileSystemNode): string {
        if (node === this.root) return '/';
        const parts = [];
        let cur: FileSystemNode | null | undefined = node;
        while (cur && cur.parent) {
            parts.unshift(cur.name);
            cur = cur.parent;
        }
        return '/' + parts.join('/');
    }

    // --- Persistence ---

    toJSON(): any {
        return this.serializeNode(this.root);
    }

    private serializeNode(node: FileSystemNode): any {
        const obj: any = {
            name: node.name,
            isDirectory: node.isDirectory,
            lastModified: node.lastModified.toISOString()
        };

        if (!node.isDirectory) {
            obj.content = node.content;
            obj.mimeType = node.mimeType;
            if (node.encoding) obj.encoding = node.encoding;
        } else if (node.children) {
            obj.children = Object.create(null);
            node.children.forEach((child, name) => {
                obj.children[name] = this.serializeNode(child);
            });
        }
        return obj;
    }

    restoreFromJSON(json: any): void {
        this.root = this.deserializeNode(json);
        this.root.parent = null;
    }

    private deserializeNode(json: any): FileSystemNode {
        const lastModified = new Date(json.lastModified ?? Date.now());
        if (!Number.isFinite(lastModified.getTime())) throw new Error('Ungültiges Dateidatum');
        const node: FileSystemNode = {
            name: json.name || '',
            isDirectory: json.isDirectory,
            lastModified,
            children: json.isDirectory ? new Map() : undefined
        };

        if (!node.isDirectory) {
            node.content = json.content || '';
            node.mimeType = json.mimeType;
            if (json.encoding === 'data-url') node.encoding = json.encoding;
        } else if (json.children) {
            Object.keys(json.children).forEach(key => {
                const child = this.deserializeNode(json.children[key]);
                child.parent = node;
                node.children!.set(key, child);
            });
        }
        return node;
    }
}

/**
 * Manages FileSystems for all hosts
 */
export class HostFileSystemManager {
    constructor(private owner?: RuntimeDependencies) {}

    private fileSystems: Map<string, FileSystem> = new Map();

    getOrCreateFileSystem(host: Host): FileSystem {
        assertRuntimeOwner(host, this.owner);
        const hostId = host.getId();
        let fs = this.fileSystems.get(hostId);
        if (!fs) {
            fs = new FileSystem(host);
            // Default directories
            fs.mkdir('/home');
            fs.mkdir('/web');
            this.fileSystems.set(hostId, fs);
        }
        return fs;
    }

    getFileSystem(hostId: string): FileSystem | null {
        return this.fileSystems.get(hostId) || null;
    }

    removeFileSystem(hostId: string): void {
        this.fileSystems.delete(hostId);
    }

    getServiceState(): { hostId: string; fsState: any }[] {
        const state: { hostId: string; fsState: any }[] = [];
        this.fileSystems.forEach((fs, hostId) => {
            state.push({
                hostId,
                fsState: fs.toJSON()
            });
        });
        return state;
    }

    restoreServiceState(state: { hostId: string; fsState: any }[], hosts: Host[]): void {
        hosts?.forEach(host => assertRuntimeOwner(host, this.owner));
        this.fileSystems.clear();
        state.forEach(s => {
            const host = hosts.find(h => h.getId() === s.hostId);
            if (host) {
                const fs = new FileSystem(host);
                fs.restoreFromJSON(s.fsState);
                this.fileSystems.set(s.hostId, fs);
            }
        });
    }

    clear(): void {
        this.fileSystems.clear();
    }
}

export const hostFileSystemManager = new HostFileSystemManager();
