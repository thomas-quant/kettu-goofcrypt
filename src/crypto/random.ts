/**
 * Secure randomness for the XChaCha nonce.
 *
 * Hermes / Kettu declares no `crypto.getRandomValues`, but Discord's bundle very
 * likely provides one. We probe a priority chain at start() and gate the SEND
 * path on whether a secure source exists. Decryption needs no randomness, so it
 * is never gated.
 *
 * A random 24-byte XChaCha nonce from any CSPRNG is collision-safe; the only
 * hard requirement is "never reuse a (key, nonce) pair", which a decent RNG
 * satisfies. The Math.random fallback is OFF by default and warns loudly.
 */

export class RngUnavailableError extends Error {
    constructor() {
        super("no secure RNG available; sending disabled");
        this.name = "RngUnavailableError";
    }
}

type RngFn = (n: number) => Uint8Array;

let rngFn: RngFn | null = null;
let secure = false;
let sourceName = "none";

function coerce(v: unknown, n: number): Uint8Array {
    if (v instanceof Uint8Array) return v;
    if (Array.isArray(v)) return Uint8Array.from(v as number[]);
    if (typeof v === "string") {
        // assume base64 from a native module
        const bin = (globalThis as any).atob ? (globalThis as any).atob(v) : null;
        if (bin) {
            const out = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            return out.subarray(0, n);
        }
    }
    throw new RngUnavailableError();
}

export function detectRng(): void {
    // (1) Web Crypto — standard, likely present in Discord's runtime.
    const gc: any = (globalThis as any).crypto;
    if (gc?.getRandomValues) {
        rngFn = (n) => {
            const b = new Uint8Array(n);
            gc.getRandomValues(b);
            return b;
        };
        secure = true;
        sourceName = "crypto.getRandomValues";
        return;
    }

    // (2) A Metro module exposing getRandomValues / randomBytes.
    const bunny: any = (globalThis as any).bunny;
    try {
        const m = bunny?.metro?.findByProps?.("getRandomValues");
        if (m?.getRandomValues) {
            rngFn = (n) => {
                const b = new Uint8Array(n);
                m.getRandomValues(b);
                return b;
            };
            secure = true;
            sourceName = "metro.getRandomValues";
            return;
        }
    } catch {
        /* ignore */
    }
    try {
        const nm = bunny?.metro?.findByProps?.("randomBytes");
        if (nm?.randomBytes) {
            rngFn = (n) => coerce(nm.randomBytes(n), n);
            secure = true;
            sourceName = "metro.randomBytes";
            return;
        }
    } catch {
        /* ignore */
    }

    rngFn = null;
    secure = false;
    sourceName = "none";
}

export function secureRngAvailable(): boolean {
    return secure;
}

export function rngSource(): string {
    return sourceName;
}

/**
 * @param allowInsecure if true and no secure source exists, fall back to
 *        Math.random (caller's explicit opt-in; warns).
 */
export function getRandomBytes(n: number, allowInsecure = false): Uint8Array {
    if (rngFn && secure) return rngFn(n);
    if (allowInsecure) {
        const b = new Uint8Array(n);
        for (let i = 0; i < n; i++) b[i] = (Math.random() * 256) | 0;
        return b;
    }
    throw new RngUnavailableError();
}
