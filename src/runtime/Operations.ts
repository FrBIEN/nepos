/** Pending protocol work is cancelled before a topology is replaced or stopped. */
export class Operations {
    private cancellations = new Set<() => void>();
    private generation = 0;
    private closed = false;

    get epoch(): number { return this.generation; }
    get disposed(): boolean { return this.closed; }
    get size(): number { return this.cancellations.size; }

    track(cancel: () => void): () => void {
        if (this.closed) throw new Error('Projekt wurde aufgeräumt');
        this.cancellations.add(cancel);
        return () => this.cancellations.delete(cancel);
    }

    cancelAll(): void {
        ++this.generation;
        const pending = [...this.cancellations];
        this.cancellations.clear();
        for (const cancel of pending) {
            try { cancel(); }
            catch (error) { console.error('Abbruch einer Protokolloperation fehlgeschlagen', error); }
        }
    }

    dispose(): void {
        if (this.closed) return;
        this.closed = true;
        this.cancelAll();
    }
}
