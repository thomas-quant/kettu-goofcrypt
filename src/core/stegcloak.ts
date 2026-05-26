/**
 * Pure-JS reimplementation of the stegcloak-rs hide/reveal pipeline.
 *
 * This mirrors the WASM lib's public surface exactly (single password, no key
 * caching, no display mark) so it can be cross-checked byte-for-byte against
 * the real `stegcloak-rs` in the test harness. The Kettu-facing wrappers
 * (multi-password, caching, mark prefix, RNG gating) live in core/encrypt.ts
 * and core/decrypt.ts and build on these.
 *
 * salt === the Discord channelId string.
 */
import { deriveKey } from "../crypto/argon";
import { aeadEncrypt, aeadDecrypt } from "../crypto/aead";
import { compress, decompress, utf8Encode, utf8Decode } from "../crypto/deflate";
import { frame, unframe, PayloadError } from "./payload";
import { conceal, extract, embed, isCloaked } from "../stego/zwc";

// Error taxonomy mirrors stegcloak-rs / GoofCord's messageEncryption.ts switch.
export class PayloadNotFoundError extends Error {
    constructor() {
        super("no hidden payload");
        this.name = "PayloadNotFoundError";
    }
}
export class DecryptionError extends Error {
    constructor() {
        super("decryption failed (wrong password or corrupt)");
        this.name = "DecryptionError";
    }
}
export class IntegrityError extends Error {
    constructor(msg = "integrity check failed") {
        super(msg);
        this.name = "IntegrityError";
    }
}

export type RandomBytes = (n: number) => Uint8Array;

/**
 * Encrypt `message` under `password`/`salt` and hide it inside `cover`.
 * `rng` supplies the 24-byte XChaCha nonce.
 */
export function hide(
    message: string,
    password: string,
    salt: string,
    cover: string,
    rng: RandomBytes,
): string {
    const key = deriveKey(password, salt);
    const compressed = compress(utf8Encode(message));
    const nonce = rng(24);
    const ctAndTag = aeadEncrypt(key, nonce, compressed);
    const payload = frame(nonce, ctAndTag);
    return embed(cover, conceal(payload));
}

/**
 * Reveal + decrypt. Throws PayloadNotFoundError / DecryptionError /
 * IntegrityError to match the upstream error contract.
 */
export function reveal(secret: string, password: string, salt: string): string {
    if (!secret || !isCloaked(secret)) throw new PayloadNotFoundError();

    const payloadBytes = extract(secret);
    let nonce: Uint8Array;
    let ctAndTag: Uint8Array;
    try {
        ({ nonce, ctAndTag } = unframe(payloadBytes));
    } catch (e) {
        if (e instanceof PayloadError) throw new IntegrityError(e.message);
        throw e;
    }

    const key = deriveKey(password, salt);

    let plaintext: Uint8Array;
    try {
        plaintext = aeadDecrypt(key, nonce, ctAndTag);
    } catch {
        throw new DecryptionError(); // wrong password or tampered ciphertext
    }

    try {
        return utf8Decode(decompress(plaintext));
    } catch (e) {
        throw new IntegrityError(`decompression failed: ${(e as Error).message}`);
    }
}

export { isCloaked };
