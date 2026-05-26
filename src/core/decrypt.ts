/**
 * Incoming-message decryption (Kettu-facing). Tries each configured password
 * (winning one first), using cached keys. Returns the marked plaintext on
 * success, or null to leave the cover text untouched (other people's messages,
 * wrong password, or not encrypted at all).
 */
import { getKey, rememberWinner, orderPasswords } from "./keycache";
import { aeadDecrypt } from "../crypto/aead";
import { decompress, utf8Decode } from "../crypto/deflate";
import { unframe } from "./payload";
import { extract, isCloaked } from "../stego/zwc";

export interface DecryptResult {
    text: string; // plaintext WITHOUT the mark prefix
    password: string; // which password decrypted it
}

/**
 * @returns the decrypted plaintext (no mark), or null if not decryptable.
 */
export function decryptMessage(content: string, channelId: string, passwords: string[]): DecryptResult | null {
    if (!content || !channelId || !isCloaked(content)) return null;
    if (passwords.length === 0) return null;

    let nonce: Uint8Array;
    let ctAndTag: Uint8Array;
    try {
        ({ nonce, ctAndTag } = unframe(extract(content)));
    } catch {
        return null; // not our payload format
    }

    for (const password of orderPasswords(channelId, passwords)) {
        if (!password) continue;
        let plaintext: Uint8Array;
        try {
            const key = getKey(channelId, password);
            plaintext = aeadDecrypt(key, nonce, ctAndTag);
        } catch {
            continue; // wrong password
        }
        try {
            const text = utf8Decode(decompress(plaintext));
            rememberWinner(channelId, password);
            return { text, password };
        } catch {
            return null; // authenticated but corrupt -> stop
        }
    }
    return null;
}
