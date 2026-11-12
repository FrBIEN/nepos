const LIMIT = 50 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { let crc = n; for (let j = 0; j < 8; j++)
    crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); return crc >>> 0; });
export function crc32(bytes: Uint8Array): number { let crc = 0xffffffff; for (const b of bytes)
    crc = (crc >>> 8) ^ crcTable[(crc ^ b) & 255]; return (crc ^ 0xffffffff) >>> 0; }
function safeName(name: string): void { if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.split('/').some(p => p === '..' || p === '.'))
    throw new Error('Ungültiger Pfad im FLS-Archiv'); }
/** ZIP is decoded in memory, with size/CRC limits, and never extracted to the host filesystem. */
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
    if (bytes.length > LIMIT)
        throw new Error('Projektdatei überschreitet 50 MB');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
        if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) {
            end = i;
            break;
        }
    if (end < 0)
        throw new Error('FLS ist kein gültiges ZIP-Archiv');
    const count = view.getUint16(end + 10, true), directory = view.getUint32(end + 16, true), size = view.getUint32(end + 12, true);
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true) || count > 10000 || directory + size !== end)
        throw new Error('Mehrteilige/ZIP64-FLS-Archive werden nicht unterstützt');
    const result = new Map<string, Uint8Array>();
    let offset = directory, total = 0;
    for (let i = 0; i < count; i++) {
        if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
            throw new Error('Beschädigtes ZIP-Verzeichnis');
        const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true), crc = view.getUint32(offset + 16, true), compressed = view.getUint32(offset + 20, true), length = view.getUint32(offset + 24, true), nameLength = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true), local = view.getUint32(offset + 42, true);
        if (offset + 46 + nameLength + extra + comment > end || flags & 1 || ![0, 8].includes(method) || local + 30 > directory || total + length > LIMIT)
            throw new Error('Ungültiges oder zu großes FLS-Archiv');
        const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
        safeName(name);
        if (result.has(name))
            throw new Error('Doppelter Pfad im FLS-Archiv');
        if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 8, true) !== method)
            throw new Error('Beschädigter ZIP-Eintrag');
        const localName = view.getUint16(local + 26, true), start = local + 30 + localName + view.getUint16(local + 28, true);
        if (start + compressed > directory || decoder.decode(bytes.subarray(local + 30, local + 30 + localName)) !== name)
            throw new Error('Beschädigter ZIP-Pfad');
        const source = bytes.slice(start, start + compressed);
        let content: Uint8Array;
        if (method === 0)
            content = source;
        else {
            const stream = new Blob([source]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            const reader = stream.getReader(), chunks: Uint8Array[] = [];
            let inflated = 0;
            try {
                while (true) {
                    const part = await reader.read();
                    if (part.done)
                        break;
                    inflated += part.value.length;
                    if (inflated > length || inflated > LIMIT)
                        throw new Error('FLS-Dekompressionsgrenze überschritten');
                    chunks.push(part.value);
                }
            }
            finally {
                await reader.cancel();
            }
            content = new Uint8Array(inflated);
            let pos = 0;
            for (const chunk of chunks) {
                content.set(chunk, pos);
                pos += chunk.length;
            }
        }
        if (content.length !== length || crc32(content) !== crc)
            throw new Error('FLS-Prüfsumme oder Dateigröße stimmt nicht');
        total += length;
        result.set(name, content);
        offset += 46 + nameLength + extra + comment;
    }
    if (offset !== end)
        throw new Error('Beschädigtes ZIP-Verzeichnis');
    return result;
}
/** Uncompressed ZIP entries are universally readable by Java's ZipFile and browsers. */
export function writeZip(files: Map<string, Uint8Array>): Uint8Array<ArrayBuffer> {
    const local: Uint8Array[] = [], central: Uint8Array[] = [];
    let position = 0, total = 0;
    for (const [name, data] of files) {
        safeName(name);
        total += data.length;
        if (total > LIMIT)
            throw new Error('Projektarchiv überschreitet 50 MB');
        const filename = encoder.encode(name);
        if (filename.length > 65535)
            throw new Error('ZIP-Pfad zu lang');
        const crc = crc32(data);
        const header = new Uint8Array(30 + filename.length), v = new DataView(header.buffer);
        v.setUint32(0, 0x04034b50, true);
        v.setUint16(4, 20, true);
        v.setUint16(6, 0x800, true);
        v.setUint32(14, crc, true);
        v.setUint32(18, data.length, true);
        v.setUint32(22, data.length, true);
        v.setUint16(26, filename.length, true);
        header.set(filename, 30);
        local.push(header, data);
        const entry = new Uint8Array(46 + filename.length), e = new DataView(entry.buffer);
        e.setUint32(0, 0x02014b50, true);
        e.setUint16(4, 20, true);
        e.setUint16(6, 20, true);
        e.setUint16(8, 0x800, true);
        e.setUint32(16, crc, true);
        e.setUint32(20, data.length, true);
        e.setUint32(24, data.length, true);
        e.setUint16(28, filename.length, true);
        e.setUint32(42, position, true);
        entry.set(filename, 46);
        central.push(entry);
        position += header.length + data.length;
    }
    const directorySize = central.reduce((s, p) => s + p.length, 0), end = new Uint8Array(22), v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, files.size, true);
    v.setUint16(10, files.size, true);
    v.setUint32(12, directorySize, true);
    v.setUint32(16, position, true);
    const result = new Uint8Array(position + directorySize + 22);
    let offset = 0;
    for (const chunk of [...local, ...central, end]) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    if (result.length > LIMIT)
        throw new Error('Projektarchiv überschreitet 50 MB');
    return result;
}
