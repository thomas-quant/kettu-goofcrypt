/**
 * XChaCha20-Poly1305 AEAD, matching stegcloak-rs (src/encrypt.rs).
 *
 * - 24-byte nonce (XChaCha), 16-byte Poly1305 tag.
 * - AAD is the single version byte [0x01], bound to the tag.
 * - noble's `.encrypt` returns ciphertext||tag; `.decrypt` consumes the same
 *   layout and throws on authentication failure (our "wrong password" signal).
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha";

export const VERSION_1 = 0x01;
export const NONCE_LENGTH = 24;
export const TAG_LENGTH = 16;

/** AAD = [versionByte], exactly as stegcloak-rs binds it. */
const AAD = new Uint8Array([VERSION_1]);

export function aeadEncrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Uint8Array {
    return xchacha20poly1305(key, nonce, AAD).encrypt(plaintext); // ciphertext || tag(16)
}

/** Throws if authentication fails (wrong key / tampered data). */
export function aeadDecrypt(key: Uint8Array, nonce: Uint8Array, ctAndTag: Uint8Array): Uint8Array {
    return xchacha20poly1305(key, nonce, AAD).decrypt(ctAndTag);
}
