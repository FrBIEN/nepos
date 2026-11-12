import type { ScenarioData } from './ScenarioTypes';
import { validateScenario } from './ScenarioValidation';
export interface ProjectStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
const KEY = 'nepos-project', BACKUP = 'nepos-project-backup', RECOVERY = 'nepos-project-recovery', BEFORE_REPLACE = 'nepos-project-before-replace';
const LEGACY = ['filius-web-autosave', 'filius-service-state', 'filius-doc-elements', 'filius-project-title', 'filius-project-desc'];
function parse(raw: string): ScenarioData {
    const value: unknown = JSON.parse(raw); validateScenario(value); return value;
}
/** Keep the previous valid document before atomically replacing the current one. */
export class ProjectStore {
    loadWarning: string | null = null;
    constructor(private storage: ProjectStorage) { }
    save(scenario: ScenarioData): void {
        validateScenario(scenario);
        const next = JSON.stringify(scenario), current = this.storage.getItem(KEY);
        if (current === next) return;
        if (current) {
            let valid = true; try { parse(current); } catch { valid = false; }
            // An unreadable original remains recoverable even after an explicit new import.
            this.storage.setItem(valid ? BACKUP : RECOVERY, current);
        }
        this.storage.setItem(KEY, next);
    }
    load(): ScenarioData | null {
        this.loadWarning = null;
        const current = this.storage.getItem(KEY);
        if (current) {
            try { return parse(current); }
            catch (error) {
                const backup = this.storage.getItem(BACKUP);
                if (backup) {
                    try {
                        const scenario = parse(backup);
                        this.loadWarning = 'Die aktuelle Speicherung ist beschädigt. Die vorherige gültige Version wurde wiederhergestellt. Automatisches Speichern ist zunächst gesperrt; sichern Sie die vorhandenen Daten.';
                        return scenario;
                    } catch { /* Preserve both documents; report the original failure. */ }
                }
                throw error;
            }
        }
        const legacy = this.storage.getItem(LEGACY[0]);
        if (!legacy) return null;
        const scenario = JSON.parse(legacy) as ScenarioData;
        const services = this.storage.getItem(LEGACY[1]), documents = this.storage.getItem(LEGACY[2]);
        if (services) scenario.serviceState = { ...scenario.serviceState, ...JSON.parse(services) };
        if (documents) scenario.docElements = JSON.parse(documents);
        scenario.name = this.storage.getItem(LEGACY[3]) ?? scenario.name;
        scenario.description = this.storage.getItem(LEGACY[4]) ?? scenario.description;
        validateScenario(scenario);
        try { this.save(scenario); }
        catch {
            this.loadWarning = 'Das bisherige Projekt wurde geladen, konnte aber noch nicht in den neuen Speicher übertragen werden. Sichern Sie es als Datei. Die ursprünglichen Daten bleiben erhalten.';
        }
        return scenario;
    }
    checkpoint(scenario: ScenarioData): void {
        validateScenario(scenario);this.storage.setItem(BEFORE_REPLACE,JSON.stringify(scenario));
    }
    recoveryDocuments(): {name: string; label: string; content: string}[] {
        return [KEY, BACKUP, RECOVERY, BEFORE_REPLACE, ...LEGACY, ...LEGACY.map(key=>'nepos-recovery-'+key)].flatMap(key => {
            const content = this.storage.getItem(key);
            const labels:Record<string,string>={[KEY]:'Aktuelles Projekt',[BACKUP]:'Vorherige Autosicherung',[RECOVERY]:'Gesichertes Original',[BEFORE_REPLACE]:'Projekt vor dem letzten Ersetzen',[LEGACY[0]]:'Ältere Topologie',[LEGACY[1]]:'Ältere Dienste und Dateien',[LEGACY[2]]:'Ältere Beschriftungen',[LEGACY[3]]:'Älterer Projekttitel',[LEGACY[4]]:'Ältere Beschreibung'};
            return content === null ? [] : [{name:key+'.json',label:labels[key] ?? 'Archiv: '+labels[key.replace(/^nepos-recovery-/, '')],content}];
        });
    }
    /** Explicitly creating a new project retains a recovery copy of the old one. */
    clear(): void {
        const current = this.storage.getItem(KEY) ?? this.storage.getItem(LEGACY[0]);
        if (current) this.storage.setItem(RECOVERY, current);
        for (const key of LEGACY) {
            const fragment=this.storage.getItem(key);
            if (fragment !== null) this.storage.setItem('nepos-recovery-'+key,fragment);
        }
        this.storage.removeItem(KEY);
        for (const key of LEGACY) this.storage.removeItem(key);
    }
}
