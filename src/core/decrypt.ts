/**
 * Incoming-message decryption using ONLY already-cached keys (synchronous, safe
 * to call from the Flux dispatch hook). Returns null on a miss — the caller is
 * responsible for kicking off async key derivation and retrying.
 */
import { getCachedKey, rememberWinner, orderPasswords } from "./keycache";
import { aeadDecrypt } from "../crypto/aead";
import { decompress, utf8Decode } from "../crypto/deflate";
import { unframe } from "./payload";
import { extract, isCloaked } from "../stego/zwc";
import { noteError } from "./health";
import type { RemoteDecodedKeySet } from "./remoteKeycache";

export interface DecryptResult {
    text: string; // plaintext WITHOUT the mark prefix
    password: string;
}

export interface ParsedCloakedPayload {
    nonce: Uint8Array;
    ctAndTag: Uint8Array;
}

export interface RemoteDecryptResult {
    text: string;
}

interface KeyAttempt {
    authenticated: boolean;
    text?: string;
}

/** Cheap exact framing gate. It performs no key lookup or derivation. */
export function parseCloakedPayload(content: string): ParsedCloakedPayload | null {
    if (!content || !isCloaked(content)) return null;
    try {
        return unframe(extract(content));
    } catch {
        return null;
    }
}

function tryKey(key: Uint8Array, parsed: ParsedCloakedPayload): KeyAttempt {
    let plaintext: Uint8Array;
    try {
        plaintext = aeadDecrypt(key, parsed.nonce, parsed.ctAndTag);
    } catch {
        return { authenticated: false };
    }
    try {
        return { authenticated: true, text: utf8Decode(decompress(plaintext)) };
    } catch (e) {
        // Authentication succeeded, so this is format skew/corruption rather
        // than a wrong-key miss. Preserve the existing health behavior.
        noteError("decryptCorrupt", e);
        return { authenticated: true };
    }
}

/** Decrypt with cached keys only; never derives. Returns null if not (yet) decryptable. */
export function decryptWithCachedKeys(content: string, channelId: string, passwords: string[]): DecryptResult | null {
    if (!channelId || passwords.length === 0) return null;
    const parsed = parseCloakedPayload(content);
    if (!parsed) return null;

    for (const password of orderPasswords(channelId, passwords)) {
        if (!password) continue;
        const key = getCachedKey(channelId, password);
        if (!key) continue; // not derived yet
        const attempt = tryKey(key, parsed);
        if (!attempt.authenticated) continue;
        if (attempt.text !== undefined) {
            rememberWinner(channelId, password);
            return { text: attempt.text, password };
        }
        return null;
    }
    return null;
}

/** Try strict remote key sets newest-to-oldest and slots in server order. */
export function decryptWithRemoteKeys(
    parsed: ParsedCloakedPayload,
    sets: RemoteDecodedKeySet[],
): RemoteDecryptResult | null {
    for (let i = 0; i < sets.length; i++) {
        const keys = sets[i].keys;
        for (let j = 0; j < keys.length; j++) {
            const attempt = tryKey(keys[j], parsed);
            if (!attempt.authenticated) continue;
            return attempt.text === undefined ? null : { text: attempt.text };
        }
    }
    return null;
}
