// Types for the entire application

export interface Position {
    x: number;
    y: number;
}

export interface Size {
    width: number;
    height: number;
}

// Unique ID generator
let nextId = 1;
export function generateId(): string {
    return `node-${nextId++}`;
}

export function resetIdCounter(): void {
    nextId = 1;
}

export function setIdCounter(value: number): void {
    nextId = Math.max(nextId, value);
}
