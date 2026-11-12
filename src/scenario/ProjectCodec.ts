import type { ScenarioData } from './ScenarioTypes';
import { validateScenario } from './ScenarioValidation';
import { crc32, readZip, writeZip } from './fls/ZipArchive';
import { importFiliusXML } from './fls/FiliusImport';
import { exportFiliusXML } from './fls/FiliusExport';
import { decodeJavaBeans } from './fls/JavaBeansData';
export type ProjectFormat = 'json' | 'fls';
export interface DecodedProject {
    scenario: ScenarioData;
    warnings: string[];
}
export interface EncodedProject {
    bytes: Uint8Array<ArrayBuffer>;
    mimeType: string;
    warnings: string[];
}
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const XML_PATH = 'projekt/konfiguration.xml', NEPOS_PATH = 'projekt/nepos.json';
/** Format conversion and validation are independent of DOM, storage and running services. */
export async function decodeProject(bytes: Uint8Array, filename: string): Promise<DecodedProject> {
    if (bytes.length > 50 * 1024 * 1024)
        throw new Error('Projektdatei überschreitet 50 MB');
    if (bytes[0] === 0x50 && bytes[1] === 0x4b || /\.fls$/i.test(filename)) {
        const files = await readZip(bytes), xmlBytes = files.get(XML_PATH) ?? [...files].find(([name]) => name.endsWith('/konfiguration.xml'))?.[1];
        if (!xmlBytes)
            throw new Error('FLS enthält keine konfiguration.xml');
        const xml = decoder.decode(xmlBytes), extension = files.get(NEPOS_PATH);
        if (extension) {
            const meta = JSON.parse(decoder.decode(extension));
            if (meta.format === 'nepos-fls-1' && meta.xmlCRC32 === crc32(xmlBytes)) {
                decodeJavaBeans(xml);
                validateScenario(meta.scenario);
                return { scenario: meta.scenario, warnings: [] };
            }
        }
        const result = importFiliusXML(xml, filename.replace(/\.fls$/i, ''));
        validateScenario(result.scenario);
        if (extension)
            result.warnings.unshift('Die Filius-Konfiguration wurde geändert. Veraltete Nepos-Zusatzdaten wurden deshalb nicht übernommen.');
        return result;
    }
    const scenario: unknown = JSON.parse(decoder.decode(bytes));
    validateScenario(scenario);
    return { scenario, warnings: [] };
}
export function encodeProject(scenario: ScenarioData, format: ProjectFormat): EncodedProject {
    validateScenario(scenario);
    if (format === 'json')
        return { bytes: encoder.encode(JSON.stringify(scenario, null, 2)), mimeType: 'application/json', warnings: [] };
    const { xml, warnings } = exportFiliusXML(scenario), xmlBytes = encoder.encode(xml);
    const files = new Map([[XML_PATH, xmlBytes], ['projekt/anwendungen/EigeneAnwendungen.txt', encoder.encode('')], [NEPOS_PATH, encoder.encode(JSON.stringify({ format: 'nepos-fls-1', xmlCRC32: crc32(xmlBytes), scenario }))]]);
    return { bytes: writeZip(files), mimeType: 'application/zip', warnings };
}
