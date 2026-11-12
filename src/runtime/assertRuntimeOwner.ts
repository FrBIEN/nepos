import type { RuntimeDependencies } from './RuntimeDependencies';

/** Service registries cannot accept devices from another project, even when IDs match. */
export function assertRuntimeOwner(host: { runtime: RuntimeDependencies }, owner?: RuntimeDependencies): void {
    if (owner && host.runtime !== owner) throw new Error('Gerät gehört zu einem anderen Projekt');
    if (owner?.operations.disposed) throw new Error('Projekt wurde aufgeräumt');
}
