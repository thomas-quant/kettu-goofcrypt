/**
 * Outgoing-message encryption given an already-derived key (key derivation is
 * handled asynchronously by the caller via keycache).
 */
import { aeadEncrypt } from "../crypto/aead";
import { compress, utf8Encode } from "../crypto/deflate";
import { frame } from "./payload";
import { conceal, embed } from "../stego/zwc";
import type { RandomBytes } from "./stegcloak";

/** Discord's hard message-content limit (non-nitro). Concealed output counts. */
export const DISCORD_CONTENT_LIMIT = 2000;

export class MessageTooLongError extends Error {
    constructor(public length: number) {
        super(`encrypted message is ${length} chars, over Discord's ${DISCORD_CONTENT_LIMIT} limit`);
        this.name = "MessageTooLongError";
    }
}

export function encryptWithKey(plaintext: string, key: Uint8Array, cover: string, rng: RandomBytes): string {
    const compressed = compress(utf8Encode(plaintext));
    const nonce = rng(24);
    const ctAndTag = aeadEncrypt(key, nonce, compressed);
    const out = embed(cover, conceal(frame(nonce, ctAndTag)));
    if (out.length > DISCORD_CONTENT_LIMIT) throw new MessageTooLongError(out.length);
    return out;
}
