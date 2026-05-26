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

export interface DecryptResult {
    text: string; // plaintext WITHOUT the mark prefix
    password: string;
}

/** Decrypt with cached keys only; never derives. Returns null if not (yet) decryptable. */
export function decryptWithCachedKeys(content: string, channelId: string, passwords: string[]): DecryptResult | null {
    if (!content || !channelId || passwords.length === 0 || !isCloaked(content)) return null;

    let nonce: Uint8Array;
    let ctAndTag: Uint8Array;
    try {
        ({ nonce, ctAndTag } = unframe(extract(content)));
    } catch {
        return null;
    }

    for (const password of orderPasswords(channelId, passwords)) {
        if (!password) continue;
        const key = getCachedKey(channelId, password);
        if (!key) continue; // not derived yet
        let plaintext: Uint8Array;
        try {
            plaintext = aeadDecrypt(key, nonce, ctAndTag);
        } catch {
            continue; // wrong password
        }
        try {
            const text = utf8Decode(decompress(plaintext));
            rememberWinner(channelId, password);
            return { text, password };
        } catch (e) {
            // Authenticated with the right key but decompression failed — a real
            // red flag (format/version skew with desktop GoofCord), not a miss.
            noteError("decryptCorrupt", e);
            return null;
        }
    }
    return null;
}
