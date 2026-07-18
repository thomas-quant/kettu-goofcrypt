/** Memory-only remote cloud-key and verification state. */
import { createDeriveRequest } from "./contracts";
import { RemoteKdfError } from "./client";

let cloudKey: string | undefined;
let verifiedRevision: string | undefined;
let verifiedGeneration = -1;

export interface RemoteSessionState {
    keyPresent: boolean;
    verified: boolean;
}

export function setRemoteCloudKey(value: string): void {
    const parsed = createDeriveRequest("1", value);
    if (!parsed.ok) throw new RemoteKdfError("REMOTE_KEY_REQUIRED");
    cloudKey = value;
    clearRemoteVerification();
}

/** Internal coordinator access; never expose this through status/debug APIs. */
export function remoteCloudKey(): string | null {
    return cloudKey ?? null;
}

export function markRemoteVerified(settingsRevision: string, generation: number): void {
    if (!cloudKey) throw new RemoteKdfError("REMOTE_KEY_REQUIRED");
    verifiedRevision = settingsRevision;
    verifiedGeneration = generation;
}

export function isRemoteVerified(settingsRevision: string | undefined, generation: number): boolean {
    return !!cloudKey
        && !!settingsRevision
        && verifiedRevision === settingsRevision
        && verifiedGeneration === generation;
}

export function clearRemoteVerification(): void {
    verifiedRevision = undefined;
    verifiedGeneration = -1;
}

export function remoteSessionState(): RemoteSessionState {
    return { keyPresent: !!cloudKey, verified: verifiedRevision !== undefined };
}

export function clearRemoteSession(): void {
    cloudKey = undefined;
    clearRemoteVerification();
}
