/**
 * Payload framing, matching stegcloak-rs (src/encrypt.rs encrypt_with_key):
 *   [0x01 version] ++ [24-byte nonce] ++ [ciphertext ++ 16-byte tag]
 */
import { VERSION_1, NONCE_LENGTH, TAG_LENGTH } from "../crypto/aead";

export class PayloadError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = "PayloadError";
    }
}

export function frame(nonce: Uint8Array, ctAndTag: Uint8Array): Uint8Array {
    const out = new Uint8Array(1 + NONCE_LENGTH + ctAndTag.length);
    out[0] = VERSION_1;
    out.set(nonce, 1);
    out.set(ctAndTag, 1 + NONCE_LENGTH);
    return out;
}

export function unframe(bytes: Uint8Array): { nonce: Uint8Array; ctAndTag: Uint8Array } {
    if (bytes.length < 1 + NONCE_LENGTH + TAG_LENGTH) {
        throw new PayloadError("payload too short");
    }
    if (bytes[0] !== VERSION_1) {
        throw new PayloadError(`unsupported payload version ${bytes[0]}`);
    }
    return {
        nonce: bytes.subarray(1, 1 + NONCE_LENGTH),
        ctAndTag: bytes.subarray(1 + NONCE_LENGTH),
    };
}
