/**
 * Strict mobile HTTP boundary for the authenticated remote-KDF v1 API.
 * Runtime transport capabilities are probed explicitly because DOM typings do
 * not prove that Discord's current Hermes/React Native build exposes them.
 */
import {
    KDF_ERROR_STATUS,
    createDeriveRequest,
    parseDeriveResponse,
    parseErrorResponse,
    parseRevisionResponse,
    type KdfDeriveResponse,
    type KdfErrorCode,
    type KdfRevisionResponse,
} from "./contracts";
import { utf8Decode, utf8Encode } from "../crypto/deflate";

// Eight sequential Stage 2 slots × 30,000 ms worker budget, plus 30,000 ms for
// cloud-scrypt/decryption and network overhead. This is one full-batch budget.
export const REMOTE_DERIVE_TIMEOUT_MS = 270000;
export const REMOTE_REVISION_TIMEOUT_MS = 15000;
export const MAX_REMOTE_RESPONSE_UTF8_BYTES = 16384;

export const REMOTE_CLIENT_ERROR_CODES = [
    "REMOTE_NOT_CONFIGURED",
    "REMOTE_KEY_REQUIRED",
    "REMOTE_TIMEOUT",
    "REMOTE_UNAVAILABLE",
    "REMOTE_PROTOCOL_ERROR",
    "REMOTE_UNSUPPORTED",
    "REMOTE_STALE",
    "REMOTE_COOLDOWN",
    "REMOTE_SLOT_UNAVAILABLE",
    "REMOTE_SEND_REJECTED",
] as const;

export type RemoteClientErrorCode = typeof REMOTE_CLIENT_ERROR_CODES[number];
export type RemoteKdfErrorCode = KdfErrorCode | RemoteClientErrorCode;
export type RemoteBoundingMode = "stream" | "content-length" | "unsupported";

export class RemoteKdfError extends Error {
    constructor(readonly code: RemoteKdfErrorCode) {
        super(code);
        this.name = "RemoteKdfError";
    }
}

export interface RemoteTransportOverrides {
    fetchFn?: typeof fetch | null;
    AbortControllerCtor?: typeof AbortController | null;
    URLCtor?: typeof URL | null;
    ResponseCtor?: typeof Response | null;
}

export interface RemoteClientDependencies extends RemoteTransportOverrides {
    schedule?: (callback: () => void, milliseconds: number) => unknown;
    cancel?: (handle: unknown) => void;
}

export interface RemoteTransportCapabilities {
    supported: boolean;
    boundingMode: RemoteBoundingMode;
    code?: "REMOTE_UNSUPPORTED";
}

export interface RemoteClientConfiguration {
    origin: string;
    token: string;
}

export interface RemoteKdfClient {
    derive(channelId: string, cloudEncryptionKey: string): Promise<KdfDeriveResponse>;
    revision(): Promise<KdfRevisionResponse>;
    abortAll(): void;
    capabilities(): RemoteTransportCapabilities;
}

type AbortControllerLike = {
    signal: AbortSignal;
    abort(): void;
};

function own<T>(value: T | undefined, fallback: T): T {
    return value === undefined ? fallback : value;
}

function globalFetch(): typeof fetch | null {
    return typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;
}

function globalAbortController(): typeof AbortController | null {
    return typeof globalThis.AbortController === "function" ? globalThis.AbortController : null;
}

function globalUrl(): typeof URL | null {
    return typeof globalThis.URL === "function" ? globalThis.URL : null;
}

function globalResponse(): typeof Response | null {
    return typeof globalThis.Response === "function" ? globalThis.Response : null;
}

function unsupported(): RemoteTransportCapabilities {
    return { supported: false, boundingMode: "unsupported", code: "REMOTE_UNSUPPORTED" };
}

export function probeRemoteTransport(overrides: RemoteTransportOverrides = {}): RemoteTransportCapabilities {
    const fetchFn = own(overrides.fetchFn, globalFetch());
    const AbortCtor = own(overrides.AbortControllerCtor, globalAbortController());
    const URLCtor = own(overrides.URLCtor, globalUrl());
    const ResponseCtor = own(overrides.ResponseCtor, globalResponse());
    if (typeof fetchFn !== "function" || !AbortCtor || !URLCtor || !ResponseCtor) return unsupported();

    try {
        const controller = new AbortCtor() as AbortControllerLike;
        if (!controller.signal || typeof controller.abort !== "function") return unsupported();
        controller.abort();
        if (controller.signal.aborted !== true) return unsupported();

        const parsed = new URLCtor("https://remote-kdf.invalid:443/");
        if (parsed.protocol !== "https:" || parsed.hostname !== "remote-kdf.invalid" || parsed.pathname !== "/") {
            return unsupported();
        }

        const sample = new ResponseCtor("{}", {
            status: 200,
            headers: { "content-type": "application/json", "content-length": "2" },
        });
        if (
            typeof sample.status !== "number"
            || !sample.headers
            || typeof sample.headers.get !== "function"
            || typeof sample.text !== "function"
            || sample.headers.get("content-length") !== "2"
        ) {
            return unsupported();
        }
        const reader = (sample.body as any)?.getReader;
        return { supported: true, boundingMode: typeof reader === "function" ? "stream" : "content-length" };
    } catch {
        return unsupported();
    }
}

function fail(code: RemoteKdfErrorCode): never {
    throw new RemoteKdfError(code);
}

export function normalizeRemoteToken(value: string): string {
    const token = typeof value === "string" ? value.trim() : "";
    if (!/^[a-f0-9]{32}$/.test(token)) fail("REMOTE_NOT_CONFIGURED");
    return token;
}

function isLoopbackHostname(hostname: string): boolean {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function normalizeRemoteOrigin(
    value: string,
    allowInsecureLocalhost: boolean,
    URLCtor: typeof URL | null = globalUrl(),
): string {
    if (!URLCtor || typeof value !== "string") fail("REMOTE_UNSUPPORTED");
    let parsed: URL;
    try {
        parsed = new URLCtor(value.trim());
    } catch {
        fail("REMOTE_NOT_CONFIGURED");
    }
    if (
        parsed.username
        || parsed.password
        || parsed.pathname !== "/"
        || parsed.search
        || parsed.hash
        || !parsed.hostname
    ) {
        fail("REMOTE_NOT_CONFIGURED");
    }
    if (parsed.protocol === "https:") return parsed.origin;
    if (parsed.protocol === "http:" && allowInsecureLocalhost && isLoopbackHostname(parsed.hostname)) {
        return parsed.origin;
    }
    fail("REMOTE_NOT_CONFIGURED");
}

function declaredLength(response: Response): number | null | "invalid" {
    const raw = response.headers.get("content-length");
    if (raw === null) return null;
    const value = raw.trim();
    if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return "invalid";
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : "invalid";
}

async function readBoundedResponse(response: Response, controller: AbortControllerLike): Promise<string> {
    if (!response.headers || typeof response.headers.get !== "function") fail("REMOTE_UNSUPPORTED");
    const length = declaredLength(response);
    if (length === "invalid") fail("REMOTE_PROTOCOL_ERROR");
    if (length !== null && length > MAX_REMOTE_RESPONSE_UTF8_BYTES) {
        controller.abort();
        fail("REMOTE_PROTOCOL_ERROR");
    }

    const body = response.body as any;
    if (body && typeof body.getReader === "function") {
        const reader = body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
            while (true) {
                const item = await reader.read();
                if (item?.done) break;
                if (!(item?.value instanceof Uint8Array)) fail("REMOTE_PROTOCOL_ERROR");
                total += item.value.length;
                if (total > MAX_REMOTE_RESPONSE_UTF8_BYTES) {
                    try {
                        await reader.cancel();
                    } catch {}
                    controller.abort();
                    fail("REMOTE_PROTOCOL_ERROR");
                }
                chunks.push(Uint8Array.from(item.value));
            }
        } finally {
            try {
                reader.releaseLock?.();
            } catch {}
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (let i = 0; i < chunks.length; i++) {
            bytes.set(chunks[i], offset);
            offset += chunks[i].length;
        }
        return utf8Decode(bytes);
    }

    if (length === null || typeof response.text !== "function") fail("REMOTE_UNSUPPORTED");
    const text = await response.text();
    if (utf8Encode(text).length > MAX_REMOTE_RESPONSE_UTF8_BYTES) {
        controller.abort();
        fail("REMOTE_PROTOCOL_ERROR");
    }
    return text;
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        fail("REMOTE_PROTOCOL_ERROR");
    }
}

export function createRemoteKdfClient(
    configuration: RemoteClientConfiguration,
    dependencies: RemoteClientDependencies = {},
): RemoteKdfClient {
    const fetchFn = own(dependencies.fetchFn, globalFetch());
    const AbortCtor = own(dependencies.AbortControllerCtor, globalAbortController());
    const URLCtor = own(dependencies.URLCtor, globalUrl());
    const ResponseCtor = own(dependencies.ResponseCtor, globalResponse());
    const capabilities = probeRemoteTransport({ fetchFn, AbortControllerCtor: AbortCtor, URLCtor, ResponseCtor });
    const schedule = dependencies.schedule ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
    const cancel = dependencies.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    const controllers = new Set<AbortControllerLike>();

    let origin = "";
    let token = "";
    if (capabilities.supported) {
        origin = normalizeRemoteOrigin(configuration.origin, true, URLCtor);
        token = normalizeRemoteToken(configuration.token);
    }

    async function request<T>(path: "/v2/kdf/derive" | "/v2/kdf/revision", init: RequestInit, timeoutMs: number): Promise<T> {
        if (!capabilities.supported || !fetchFn || !AbortCtor) fail("REMOTE_UNSUPPORTED");
        const controller = new AbortCtor() as AbortControllerLike;
        controllers.add(controller);
        let timedOut = false;
        const timer = schedule(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);
        const url = origin + path;

        try {
            const response = await fetchFn(url, {
                ...init,
                redirect: "error",
                cache: "no-store",
                signal: controller.signal,
                headers: {
                    ...(init.headers as Record<string, string> | undefined),
                    authorization: token,
                },
            });
            if (
                !response
                || typeof response.status !== "number"
                || !response.headers
                || typeof response.headers.get !== "function"
            ) {
                fail("REMOTE_UNSUPPORTED");
            }
            if (response.redirected === true || (response.url && response.url !== url)) fail("REMOTE_PROTOCOL_ERROR");
            const contentType = response.headers.get("content-type") ?? "";
            if (!/^application\/json(?:\s*;|$)/i.test(contentType)) fail("REMOTE_PROTOCOL_ERROR");
            const value = parseJson(await readBoundedResponse(response, controller));

            if (response.status === 200) {
                const parsed = path === "/v2/kdf/derive" ? parseDeriveResponse(value) : parseRevisionResponse(value);
                if (!parsed.ok) fail("REMOTE_PROTOCOL_ERROR");
                return parsed.value as T;
            }
            const parsedError = parseErrorResponse(value);
            if (!parsedError.ok || KDF_ERROR_STATUS[parsedError.value.error.code] !== response.status) {
                fail("REMOTE_PROTOCOL_ERROR");
            }
            fail(parsedError.value.error.code);
        } catch (error) {
            if (error instanceof RemoteKdfError) throw error;
            if (timedOut) fail("REMOTE_TIMEOUT");
            fail("REMOTE_UNAVAILABLE");
        } finally {
            cancel(timer);
            controllers.delete(controller);
        }
    }

    return {
        derive(channelId, cloudEncryptionKey) {
            const parsed = createDeriveRequest(channelId, cloudEncryptionKey);
            if (!parsed.ok) return Promise.reject(new RemoteKdfError("REMOTE_PROTOCOL_ERROR"));
            return request<KdfDeriveResponse>(
                "/v2/kdf/derive",
                {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(parsed.value),
                },
                REMOTE_DERIVE_TIMEOUT_MS,
            );
        },
        revision() {
            return request<KdfRevisionResponse>("/v2/kdf/revision", { method: "GET" }, REMOTE_REVISION_TIMEOUT_MS);
        },
        abortAll() {
            for (const controller of Array.from(controllers)) controller.abort();
            controllers.clear();
        },
        capabilities: () => ({ ...capabilities }),
    };
}
