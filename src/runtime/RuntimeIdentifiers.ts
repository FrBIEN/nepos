/** Identifiers and default device names belong to one project. */
export class RuntimeIdentifiers {
    private nextId = 1;
    private names = new Map<string, number>();
    generateId(): string { return `node-${this.nextId++}`; }
    setIdCounter(value: number): void { this.nextId = Math.max(this.nextId, value); }
    reset(): void { this.nextId = 1; this.names.clear(); }
    nextName(kind: string): number { const value = this.names.get(kind) ?? 1; this.names.set(kind, value + 1); return value; }
    reserveName(kind: string, value: number): void { this.names.set(kind, Math.max(this.names.get(kind) ?? 1, value + 1)); }
    resetNames(kind: string): void { this.names.delete(kind); }
}
