/** Data-only decoder for the JavaBeans XML subset used by Filius. No Java reflection or code execution. */
interface XMLNode {
    tag: string;
    attrs: Record<string, string>;
    children: XMLNode[];
    text: string;
    content: (string | XMLNode)[];
}
export type BeanValue = Bean | string | number | boolean | null;
export class Bean {
    properties = new Map<string, BeanValue>();
    items: BeanValue[] = [];
    entries = new Map<string, BeanValue>();
    fields = new Map<string, BeanValue>();
    args: BeanValue[] = [];
    constructor(public className = '', public fieldName?: string) { }
}
export const bean = (value: BeanValue | undefined): Bean | undefined => value instanceof Bean ? value : undefined;
export const prop = (value: BeanValue | undefined, name: string): BeanValue | undefined => bean(value)?.properties.get(name);
export const list = (value: BeanValue | undefined): BeanValue[] => bean(value)?.items ?? [];
export const string = (value: BeanValue | undefined, fallback = ''): string => typeof value === 'string' ? value : fallback;
export const number = (value: BeanValue | undefined, fallback = 0): number => typeof value === 'number' ? value : fallback;
export const bool = (value: BeanValue | undefined, fallback = false): boolean => typeof value === 'boolean' ? value : fallback;
function entities(text: string): string {
    if(/&(?!amp;|lt;|gt;|quot;|apos;|#(?:[0-9]+|x[0-9a-f]+);)/i.test(text))throw new Error("Ungültige XML-Entität");
    return text.replace(/&([^;\s]+);/g, (_, entity: string) => {
        const chars: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
        if (Object.hasOwn(chars, entity))
            return chars[entity];
        if (!/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(entity))
            throw new Error('Unbekannte XML-Entität');
        const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        if (code < 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff)
            throw new Error('Ungültiges XML-Zeichen');
        return String.fromCodePoint(code);
    });
}
function parseXML(xml: string): XMLNode {
    if (xml.length > 40 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))
        throw new Error('FLS-XML enthält unzulässige Definitionen oder ist zu groß');
    const root: XMLNode = { tag: '#document', attrs: {}, children: [], text: '', content: [] }, stack = [root];
    let count = 0, cursor = 0;
    const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g;
    for (const match of xml.matchAll(tokens)) {
        if (match.index !== cursor)
            throw new Error('Beschädigtes FLS-XML');
        const token = match[0];
        cursor += token.length;
        if (token.startsWith('<!--') || token.startsWith('<?xml'))
            continue;
        if (token.startsWith('<![CDATA[')) {
            stack.at(-1)!.text += token.slice(9, -3);
            stack.at(-1)!.content.push(token.slice(9, -3));
            continue;
        }
        if (token.startsWith('</')) {
            if (stack.length <= 1 || token.slice(2, -1).trim() !== stack.at(-1)!.tag)
                throw new Error('FLS-XML-Tags passen nicht zusammen');
            stack.pop();
            continue;
        }
        if (token.startsWith('<')) {
            const matchTag = /^<([\w.-]+)/.exec(token);
            if (!matchTag)
                throw new Error('Unzulässiges FLS-XML');
            const tag = matchTag[1];
            const attrs: Record<string, string> = Object.create(null);
            let remaining = token.slice(matchTag[0].length).replace(/\/?\s*>$/, '');
            while (remaining.trim()) {
                const attr = /^\s+([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(remaining);
                if (!attr || attr[1] in attrs)
                    throw new Error('Beschädigte XML-Attribute');
                attrs[attr[1]] = entities(attr[2] ?? attr[3]);
                remaining = remaining.slice(attr[0].length);
            }
            const node: XMLNode = { tag, attrs, children: [], text: '', content: [] };
            stack.at(-1)!.children.push(node);
            stack.at(-1)!.content.push(node);
            if (++count > 600000 || stack.length > 128)
                throw new Error('FLS-XML-Struktur zu groß');
            if (!token.endsWith('/>'))
                stack.push(node);
        }
        else {
            const text = entities(token);
            stack.at(-1)!.text += text;
            stack.at(-1)!.content.push(text);
        }
    }
    if (cursor !== xml.length || stack.length !== 1 || root.children.length !== 1 || root.children[0].tag !== 'java')
        throw new Error('Kein vollständiges Filius-JavaBeans-XML');
    return root.children[0];
}
export function decodeJavaBeans(xml: string): BeanValue[] {
    const root = parseXML(xml), ids = new Map<string, BeanValue>(), defined = new Set<string>();
    const declare = (node: XMLNode) => { if (node.attrs.id) {
        if (ids.has(node.attrs.id))
            throw new Error('Doppelte XML-Objektkennung');
        ids.set(node.attrs.id, new Bean(node.attrs.class));
    } node.children.forEach(declare); };
    declare(root);
    const remember = (node: XMLNode, value: BeanValue) => { if (node.attrs.id) {
        if (defined.has(node.attrs.id))
            throw new Error('Doppelte XML-Objektkennung');
        defined.add(node.attrs.id);
        ids.set(node.attrs.id, value);
    } return value; };
    const read = (node: XMLNode, parent?: Bean): BeanValue => {
        const a = node.attrs;
        let value: BeanValue;
        const args = () => node.children.filter(c => c.tag !== 'void').map(c => read(c));
        if (a.idref) {
            if (!ids.has(a.idref))
                throw new Error(`Unbekannter XML-Verweis: ${a.idref}`);
            value = ids.get(a.idref)!;
        }
        else if (node.tag === 'void') {
            const values = args();
            if (a.property) {
                if (!parent)
                    throw new Error('XML-Eigenschaft ohne Objekt');
                if (values.length)
                    parent.properties.set(a.property, values[0]);
                if (!parent.properties.has(a.property))
                    parent.properties.set(a.property, a.id ? ids.get(a.id)! : new Bean(a.property));
                value = parent.properties.get(a.property)!;
            }
            else if (a.index !== undefined) {
                if (!parent || !/^\d+$/.test(a.index) || Number(a.index) > 500000)
                    throw new Error('Ungültiger XML-Index');
                const index = Number(a.index);
                if (values.length)
                    parent.items[index] = values[0];
                if (parent.items[index] === undefined)
                    parent.items[index] = a.id ? ids.get(a.id)! : new Bean();
                value = parent.items[index];
            }
            else if (a.method === 'add') {
                if (!parent || values.length !== 1)
                    throw new Error('Ungültige XML-Liste');
                parent.items.push(values[0]);
                value = null;
            }
            else if (a.method === 'put') {
                if (!parent || values.length !== 2)
                    throw new Error('Ungültige XML-Tabelle');
                parent.entries.set(String(values[0]), values[1]);
                value = null;
            }
            else if (a.method === 'get') {
                if (!parent || values.length !== 1)
                    throw new Error('Ungültiger XML-Tabellenzugriff');
                const key = String(values[0]);
                if (!parent.entries.has(key))
                    parent.entries.set(key, new Bean(key));
                value = parent.entries.get(key)!;
            }
            else if (a.method === 'getField' && ['java.awt.Rectangle', 'filius.software.firewall.FirewallRule'].includes(a.class)) {
                value = new Bean('field', String(values[0]));
            }
            else if (a.method === 'set' && parent?.fieldName) {
                const target = bean(values[0]);
                if (!target || values.length !== 2)
                    throw new Error('Ungültiges XML-Geometriefeld');
                target.fields.set(parent.fieldName, values[1]);
                value = null;
            }
            else if (a.method === 'isEnabled') {
                value = true;
            }
            else if (['addMouseListener', 'addPropertyChangeListener'].includes(a.method)) {
                value = null;
            }
            else
                throw new Error(`Nicht unterstützte XML-Datenoperation: ${a.method ?? node.tag}`);
        }
        else if (node.tag === 'string') {
            if(node.children.some(child=>child.tag!=='char'))throw new Error('Ungültiges XML-Stringelement');
            value = node.content.map(part => typeof part === 'string' ? part : string(read(part))).join('');
        }
        else if (node.tag === 'null') {
            value = null;
        }
        else if (node.tag === 'boolean') {
            if (!['true', 'false'].includes(node.text.trim()))
                throw new Error('Ungültiger XML-Wahrheitswert');
            value = node.text.trim() === 'true';
        }
        else if (['int', 'long', 'short', 'byte', 'float', 'double'].includes(node.tag)) {
            value = Number(node.text);
            if (!Number.isFinite(value))
                throw new Error('Ungültige XML-Zahl');
        }
        else if (node.tag === 'char') {
            if(a.code&&!/^#[0-9a-f]{1,4}$/i.test(a.code))throw new Error('Ungültiges XML-Zeichen');
            value = a.code ? String.fromCharCode(parseInt(a.code.replace('#', ''), 16)) : node.text;
        }
        else if (node.tag === 'object' || node.tag === 'array') {
            const name = a.class ?? '';
            if (!/^(filius\.|java\.util\.|java\.awt\.(Rectangle|Color|Font)$|java\.lang\.(Integer|Boolean|Long|String)$|javax\.swing\.)/.test(name) && node.tag !== 'array')
                throw new Error(`Unzulässige XML-Datenklasse: ${name}`);
            if (a.method && a.method !== 'sharedInstance')
                throw new Error(`Unzulässige XML-Klassenoperation: ${a.method}`);
            const result = bean(a.id ? ids.get(a.id) : undefined) ?? new Bean(name);
            result.className = name;
            value = result;
            remember(node, value);
            result.args = args();
            if (node.tag === 'array') {
                const length = Number(a.length);
                if (!Number.isInteger(length) || length < 0 || length > 500000)
                    throw new Error('Ungültige XML-Arraygröße');
                result.items = Array(length).fill(null);
            }
            if (a.field)
                result.properties.set('$constant', a.field);
            for (const child of node.children)
                if (child.tag === 'void')
                    read(child, result);
            return value;
        }
        else
            throw new Error(`Unzulässiges XML-Datenelement: ${node.tag}`);
        remember(node, value);
        for (const child of node.children)
            if (child.tag === 'void')
                read(child, bean(value));
        return value;
    };
    return root.children.map(n => read(n));
}
