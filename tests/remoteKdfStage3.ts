/** Focused Stage 3 remote-KDF mobile boundary checks. */
import {
    MAX_REMOTE_RESPONSE_UTF8_BYTES,
    REMOTE_DERIVE_TIMEOUT_MS,
    REMOTE_REVISION_TIMEOUT_MS,
    RemoteKdfError,
    createRemoteKdfClient,
    normalizeRemoteOrigin,
    normalizeRemoteToken,
    probeRemoteTransport,
} from "../src/cloud/client";
import {
    clearRemoteSession,
    remoteSessionState,
    setRemoteCloudKey,
} from "../src/cloud/session";
import {
    MAX_REMOTE_REVISIONS_PER_CHANNEL,
    applyRemoteRevision,
    clearRemoteKeyCache,
    getRemoteRevisionCheckedAt,
    getRemoteDecryptKeySets,
    getRemoteSendKeys,
    initRemoteKeyCache,
    remoteKeyCacheCounts,
    storeRemoteDerivedKeys,
} from "../src/core/remoteKeycache";
import {
    REMOTE_REVISION_TTL_MS,
    clearRemoteCache,
    ensureRemoteRevisionFresh,
    forgetRemoteConfiguration,
    initRemoteKdf,
    refreshRemoteChannel,
    refreshRemoteRevision,
    refreshRemoteRevisionOnLoad,
    remoteKdfStatus,
    saveRemoteConfiguration,
    setRemoteSessionKey,
    shutdownRemoteKdf,
} from "../src/cloud/remoteKdf";
import { DEFAULTS, initSettings, type Settings } from "../src/settings";
import {
    KDF_ERROR_CODES,
    KDF_ERROR_STATUS,
    type KdfDeriveResponse,
    type KdfRevisionResponse,
} from "../src/cloud/contracts";
import type { RemoteKdfClient } from "../src/cloud/client";
import { toBase64 } from "../src/util/base64";

export type Stage3Check = (name: string, condition: boolean, detail?: string) => void;

const KEY = "WNRTGTkvrju+EwmAg1mCEem36E040hCwFKVkROLN6AQ=";
const REVISION = "A".repeat(43);
const TOKEN = "0123456789abcdef0123456789abcdef";

function jsonResponse(body: unknown, status = 200): Response {
    const text = JSON.stringify(body);
    return new Response(text, {
        status,
        headers: {
            "content-type": "application/json",
            "content-length": String(new TextEncoder().encode(text).length),
        },
    });
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
        return "NO_ERROR";
    } catch (error) {
        return error instanceof RemoteKdfError ? error.code : "WRONG_ERROR";
    }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

export async function runRemoteKdfStage3Checks(check: Stage3Check): Promise<void> {
    console.log("\n[12] Remote KDF Stage 3 client/session boundary");

    check(
        "remote origin accepts HTTPS and explicit exact-loopback HTTP only",
        normalizeRemoteOrigin("https://cloud.example.test", false) === "https://cloud.example.test"
            && normalizeRemoteOrigin("http://127.0.0.1:3000", true) === "http://127.0.0.1:3000",
    );
    const badOrigins = [
        "http://cloud.example.test",
        "http://localhost.example.test",
        "https://user:pass@cloud.example.test",
        "https://cloud.example.test/path",
        "https://cloud.example.test?x=1",
        "ftp://cloud.example.test",
    ];
    let originsRejected = true;
    for (let i = 0; i < badOrigins.length; i++) {
        try {
            normalizeRemoteOrigin(badOrigins[i], false);
            originsRejected = false;
        } catch {}
    }
    check("remote origin rejects downgrade, credentials, paths, and lookalikes", originsRejected);
    check(
        "raw existing token validation is exact",
        normalizeRemoteToken(`  ${TOKEN}\n`) === TOKEN,
    );
    let badTokenRejected = false;
    try {
        normalizeRemoteToken(TOKEN.toUpperCase());
    } catch {
        badTokenRejected = true;
    }
    check("token rejects non-lowercase legacy-incompatible input", badTokenRejected);

    const capabilities = probeRemoteTransport();
    check("Node test transport satisfies the runtime capability contract", capabilities.supported);
    check(
        "remote client constants freeze bounded budgets",
        REMOTE_DERIVE_TIMEOUT_MS === 270000
            && REMOTE_REVISION_TIMEOUT_MS === 15000
            && MAX_REMOTE_RESPONSE_UTF8_BYTES === 16384,
    );

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createRemoteKdfClient(
        { origin: "https://cloud.example.test", token: TOKEN },
        {
            fetchFn: async (input, init) => {
                calls.push({ url: String(input), init });
                return jsonResponse({ version: 1, settingsRevision: REVISION, keys: [{ slot: 0, key: KEY }] });
            },
        },
    );
    const result = await client.derive("1234567890123456789", "session-cloud-key");
    const requestBody = JSON.parse(String(calls[0]?.init?.body));
    check(
        "derive uses only exact v2 URL, raw auth, and frozen request body",
        calls.length === 1
            && calls[0].url === "https://cloud.example.test/v2/kdf/derive"
            && (calls[0].init?.headers as Record<string, string>)?.authorization === TOKEN
            && requestBody.version === 1
            && requestBody.channelId === "1234567890123456789"
            && requestBody.cloudEncryptionKey === "session-cloud-key"
            && Object.keys(requestBody).length === 3
            && result.keys[0].key === KEY,
    );

    let revisionBudget = 0;
    const revisionCalls: Array<{ url: string; init?: RequestInit }> = [];
    const revisionClient = createRemoteKdfClient(
        { origin: "https://cloud.example.test", token: TOKEN },
        {
            fetchFn: async (input, init) => {
                revisionCalls.push({ url: String(input), init });
                return jsonResponse({ version: 1, settingsRevision: REVISION });
            },
            schedule(_callback, milliseconds) {
                revisionBudget = milliseconds;
                return 1;
            },
            cancel() {},
        },
    );
    await revisionClient.revision();
    check(
        "revision uses the exact bodyless v2 GET and fixed timeout",
        revisionCalls.length === 1
            && revisionCalls[0].url === "https://cloud.example.test/v2/kdf/revision"
            && revisionCalls[0].init?.method === "GET"
            && revisionCalls[0].init?.body === undefined
            && revisionCalls[0].init?.redirect === "error"
            && revisionCalls[0].init?.cache === "no-store"
            && revisionBudget === REMOTE_REVISION_TIMEOUT_MS,
    );

    const errorClient = createRemoteKdfClient(
        { origin: "https://cloud.example.test", token: TOKEN },
        { fetchFn: async () => jsonResponse({ version: 1, error: { code: "CLOUD_DECRYPT_FAILED" } }, 422) },
    );
    check(
        "stable server errors retain exact code/status mapping",
        await errorCode(errorClient.derive("1", "wrong-key")) === "CLOUD_DECRYPT_FAILED",
    );

    const unsupported = probeRemoteTransport({ fetchFn: null });
    check("missing transport fails closed without a request", !unsupported.supported && unsupported.code === "REMOTE_UNSUPPORTED");
    const partials = [
        probeRemoteTransport({ fetchFn: {} as typeof fetch }),
        probeRemoteTransport({ AbortControllerCtor: null }),
        probeRemoteTransport({ URLCtor: null }),
        probeRemoteTransport({ ResponseCtor: null }),
        probeRemoteTransport({ ResponseCtor: class {} as unknown as typeof Response }),
    ];
    check(
        "missing and partial runtime APIs all fail closed",
        partials.every((value) => !value.supported && value.code === "REMOTE_UNSUPPORTED"),
    );

    let allServerErrorsStable = true;
    for (let i = 0; i < KDF_ERROR_CODES.length; i++) {
        const code = KDF_ERROR_CODES[i];
        const mapped = createRemoteKdfClient(
            { origin: "https://cloud.example.test", token: TOKEN },
            { fetchFn: async () => jsonResponse({ version: 1, error: { code } }, KDF_ERROR_STATUS[code]) },
        );
        if (await errorCode(mapped.derive("1", "key")) !== code) allServerErrorsStable = false;
    }
    check("all seven server code/status pairs survive the client exactly", allServerErrorsStable);

    const wrongStatus = createRemoteKdfClient(
        { origin: "https://cloud.example.test", token: TOKEN },
        { fetchFn: async () => jsonResponse({ version: 1, error: { code: "UNAUTHORIZED" } }, 422) },
    );
    const extraSuccess = createRemoteKdfClient(
        { origin: "https://cloud.example.test", token: TOKEN },
        { fetchFn: async () => jsonResponse({ version: 1, settingsRevision: REVISION, extra: "response-secret" }) },
    );
    check(
        "status mismatches and malformed success shapes collapse to protocol error",
        await errorCode(wrongStatus.revision()) === "REMOTE_PROTOCOL_ERROR"
            && await errorCode(extraSuccess.revision()) === "REMOTE_PROTOCOL_ERROR",
    );

    let oversizedTextReads = 0;
    const declaredOversize = createRemoteKdfClient(
        { origin: "https://cloud.example.test", token: TOKEN },
        {
            fetchFn: async () => ({
                status: 200,
                redirected: false,
                url: "",
                body: null,
                headers: new Headers({
                    "content-type": "application/json",
                    "content-length": String(MAX_REMOTE_RESPONSE_UTF8_BYTES + 1),
                }),
                text: async () => {
                    oversizedTextReads++;
                    return "{}";
                },
            }) as Response,
        },
    );
    check(
        "declared oversized response is rejected before body read",
        await errorCode(declaredOversize.revision()) === "REMOTE_PROTOCOL_ERROR" && oversizedTextReads === 0,
    );

    let unboundedTextReads = 0;
    const noBound = createRemoteKdfClient(
        { origin: "https://cloud.example.test", token: TOKEN },
        {
            fetchFn: async () => ({
                status: 200,
                redirected: false,
                url: "",
                body: null,
                headers: new Headers({ "content-type": "application/json" }),
                text: async () => {
                    unboundedTextReads++;
                    return "{}";
                },
            }) as Response,
        },
    );
    check(
        "missing stream and Content-Length fails unsupported without reading",
        await errorCode(noBound.revision()) === "REMOTE_UNSUPPORTED" && unboundedTextReads === 0,
    );

    let malformedLengthReads = 0;
    const malformedLength = createRemoteKdfClient(
        { origin: "https://cloud.example.test", token: TOKEN },
        {
            fetchFn: async () => ({
                status: 200,
                redirected: false,
                url: "",
                body: null,
                headers: new Headers({ "content-type": "application/json", "content-length": "16x" }),
                text: async () => {
                    malformedLengthReads++;
                    return "{}";
                },
            }) as Response,
        },
    );
    check(
        "malformed declared length is rejected without text read",
        await errorCode(malformedLength.revision()) === "REMOTE_PROTOCOL_ERROR" && malformedLengthReads === 0,
    );

    const fallbackText = JSON.stringify({ version: 1, settingsRevision: REVISION });
    let fallbackReads = 0;
    const boundedFallback = createRemoteKdfClient(
        { origin: "https://cloud.example.test", token: TOKEN },
        {
            fetchFn: async () => ({
                status: 200,
                redirected: false,
                url: "",
                body: null,
                headers: new Headers({
                    "content-type": "application/json",
                    "content-length": String(fallbackText.length),
                }),
                text: async () => {
                    fallbackReads++;
                    return fallbackText;
                },
            }) as Response,
        },
    );
    check(
        "valid bounded Content-Length fallback reads once and validates",
        (await boundedFallback.revision()).settingsRevision === REVISION && fallbackReads === 1,
    );

    const hugeStream = createRemoteKdfClient(
        { origin: "https://cloud.example.test", token: TOKEN },
        {
            fetchFn: async () => new Response("x".repeat(MAX_REMOTE_RESPONSE_UTF8_BYTES + 1), {
                status: 200,
                headers: { "content-type": "application/json" },
            }),
        },
    );
    check(
        "chunked oversized response aborts at the hard stream cap",
        await errorCode(hugeStream.revision()) === "REMOTE_PROTOCOL_ERROR",
    );

    const exactErrorJson = JSON.stringify({ version: 1, error: { code: "CLOUD_DECRYPT_FAILED" } });
    const exactBoundedBody = exactErrorJson + " ".repeat(MAX_REMOTE_RESPONSE_UTF8_BYTES - exactErrorJson.length);
    const exactStream = createRemoteKdfClient(
        { origin: "https://cloud.example.test", token: TOKEN },
        {
            fetchFn: async () => new Response(exactBoundedBody, {
                status: 422,
                headers: { "content-type": "application/json" },
            }),
        },
    );
    check(
        "streamed response exactly at 16 KiB is accepted and strictly parsed",
        await errorCode(exactStream.derive("1", "key")) === "CLOUD_DECRYPT_FAILED",
    );

    let timeoutCallback: (() => void) | undefined;
    let timeoutBudget = 0;
    const timeoutClient = createRemoteKdfClient(
        { origin: "https://cloud.example.test", token: TOKEN },
        {
            fetchFn: (_input, init) => new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => reject(new Error("secret abort detail")));
            }),
            schedule(callback, milliseconds) {
                timeoutCallback = callback;
                timeoutBudget = milliseconds;
                return 1;
            },
            cancel() {},
        },
    );
    const timeoutPromise = timeoutClient.derive("1", "timeout-key");
    timeoutCallback?.();
    check(
        "derive timeout aborts at the exact full-batch budget without reflecting detail",
        timeoutBudget === REMOTE_DERIVE_TIMEOUT_MS
            && await errorCode(timeoutPromise) === "REMOTE_TIMEOUT",
    );

    let fetchAbortObserved = false;
    const abortClient = createRemoteKdfClient(
        { origin: "https://cloud.example.test", token: TOKEN },
        {
            fetchFn: (_input, init) => new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => {
                    fetchAbortObserved = true;
                    reject(new Error("unique-abort-exception-marker"));
                });
            }),
        },
    );
    const abortPromise = abortClient.derive("1", "unique-abort-cloud-key");
    abortClient.abortAll();
    const abortCode = await errorCode(abortPromise);
    check(
        "abortAll cancels an active fetch without reflecting caught detail",
        fetchAbortObserved
            && abortCode === "REMOTE_UNAVAILABLE"
            && abortCode.indexOf("unique-abort") < 0,
    );

    clearRemoteSession();
    setRemoteCloudKey("unique-memory-only-cloud-key");
    check("session key presence is redacted", JSON.stringify(remoteSessionState()).indexOf("unique-memory-only-cloud-key") < 0);
    clearRemoteSession();
    check("session key clears", !remoteSessionState().keyPresent && !remoteSessionState().verified);
    let oversizedKeyCode = "NO_ERROR";
    try {
        setRemoteCloudKey("ü".repeat(513));
    } catch (error) {
        oversizedKeyCode = error instanceof RemoteKdfError ? error.code : "WRONG_ERROR";
    }
    check("session cloud key enforces the frozen UTF-8 bound", oversizedKeyCode === "REMOTE_KEY_REQUIRED");

    console.log("\n[13] Remote KDF Stage 3 cache/migration/revision ordering");
    const manualStore = JSON.parse(JSON.stringify(DEFAULTS)) as Settings;
    manualStore.passwords = "manual-one,manual-two";
    manualStore.keys = { "123": { manualPasswordId: KEY } };
    const manualBefore = JSON.stringify({ passwords: manualStore.passwords, keys: manualStore.keys, chosenIndex: manualStore.chosenIndex });
    initSettings(manualStore);
    initRemoteKeyCache(manualStore);
    check(
        "manual-only storage migrates beside an empty versioned remote cache",
        manualBefore === JSON.stringify({ passwords: manualStore.passwords, keys: manualStore.keys, chosenIndex: manualStore.chosenIndex })
            && manualStore.remoteKeyCache?.version === 1,
    );

    let nullWrites = 0;
    const nullHostileStore = new Proxy(JSON.parse(JSON.stringify(DEFAULTS)) as Settings, {
        set(target, property, value) {
            if (value === null) {
                nullWrites++;
                throw new TypeError("null-hostile proxy");
            }
            return Reflect.set(target, property, value);
        },
    });
    initRemoteKeyCache(nullHostileStore);
    check(
        "remote migration assigns no null into Kettu-style storage",
        nullWrites === 0 && nullHostileStore.remoteKeyCache?.version === 1,
    );

    const corruptStore = JSON.parse(JSON.stringify(DEFAULTS)) as Settings;
    corruptStore.passwords = "keep-this-manual-secret";
    corruptStore.keys = { "55": { keepPasswordId: KEY } };
    (corruptStore as any).remoteKeyCache = {
        version: 99,
        currentRevision: REVISION,
        channels: { "55": [{ settingsRevision: REVISION, keys: [KEY], sendCapable: true }] },
    };
    initRemoteKeyCache(corruptStore);
    check(
        "unknown remote cache version fails closed without touching manual state",
        remoteKeyCacheCounts().channels === 0
            && corruptStore.passwords === "keep-this-manual-secret"
            && corruptStore.keys["55"].keepPasswordId === KEY,
    );

    const shortKey = toBase64(new Uint8Array(31));
    const longKey = toBase64(new Uint8Array(33));
    const rejectedShort = storeRemoteDerivedKeys("123", {
        version: 1,
        settingsRevision: REVISION,
        keys: [{ slot: 0, key: shortKey }],
    } as KdfDeriveResponse, 1);
    const rejectedLong = storeRemoteDerivedKeys("123", {
        version: 1,
        settingsRevision: REVISION,
        keys: [{ slot: 0, key: longKey }],
    } as KdfDeriveResponse, 1);
    (corruptStore as any).remoteKeyCache = {
        version: 1,
        currentRevision: REVISION,
        channels: { "123": [{ settingsRevision: REVISION, keys: [shortKey], sendCapable: true }] },
    };
    initRemoteKeyCache(corruptStore);
    check(
        "31-byte and 33-byte remote keys are rejected before write and read",
        !rejectedShort && !rejectedLong && getRemoteSendKeys("123") === null,
    );

    const orderedStore = JSON.parse(JSON.stringify(DEFAULTS)) as Settings;
    initRemoteKeyCache(orderedStore);
    const SLOT_KEYS = [0, 1, 2].map((slot) => toBase64(Uint8Array.from({ length: 32 }, () => slot + 1)));
    const orderedStored = storeRemoteDerivedKeys("777", {
        version: 1,
        settingsRevision: REVISION,
        keys: SLOT_KEYS.map((key, slot) => ({ slot, key })),
    }, 1);
    const orderedRead = getRemoteSendKeys("777");
    const firstReadByte = orderedRead?.[0]?.[0];
    if (orderedRead) orderedRead[0][0] = 99;
    const immutableReadByte = getRemoteSendKeys("777")?.[0]?.[0];
    const replacementKey = toBase64(Uint8Array.from({ length: 32 }, () => 9));
    storeRemoteDerivedKeys("777", {
        version: 1,
        settingsRevision: REVISION,
        keys: [{ slot: 0, key: replacementKey }],
    }, 2);
    check(
        "slot order is contiguous, returned copies are immutable, and same revision replaces",
        orderedStored
            && firstReadByte === 1
            && orderedRead?.[1]?.[0] === 2
            && orderedRead?.[2]?.[0] === 3
            && immutableReadByte === 1
            && getRemoteSendKeys("777")?.length === 1
            && getRemoteSendKeys("777")?.[0]?.[0] === 9,
    );

    const restartStore = JSON.parse(JSON.stringify(orderedStore)) as Settings;
    initRemoteKeyCache(restartStore);
    check(
        "valid remote cache survives a plain-JSON restart round trip",
        getRemoteSendKeys("777")?.[0]?.[0] === 9,
    );

    storeRemoteDerivedKeys("888", {
        version: 1,
        settingsRevision: REVISION,
        keys: [{ slot: 0, key: KEY }],
    }, 3);
    applyRemoteRevision({ version: 1, settingsRevision: "Z".repeat(43) }, 4);
    check(
        "authoritative revision changes demote every cached channel",
        getRemoteSendKeys("777") === null && getRemoteSendKeys("888") === null,
    );

    initRemoteKeyCache(manualStore);

    const revisions = ["A", "B", "C", "D"].map((value) => value.repeat(43));
    for (let i = 0; i < revisions.length; i++) {
        storeRemoteDerivedKeys("123", {
            version: 1,
            settingsRevision: revisions[i],
            keys: [{ slot: 0, key: KEY }],
        }, i + 1);
    }
    const decryptSets = getRemoteDecryptKeySets("123");
    check(
        "remote cache keeps current plus two ordered decrypt-only revisions",
        MAX_REMOTE_REVISIONS_PER_CHANNEL === 3
            && decryptSets.length === 3
            && decryptSets[0].settingsRevision === revisions[3]
            && decryptSets[2].settingsRevision === revisions[1]
            && getRemoteSendKeys("123")?.[0]?.length === 32,
    );
    applyRemoteRevision({ version: 1, settingsRevision: "E".repeat(43) }, 10);
    check("authoritative revision change globally removes send capability", getRemoteSendKeys("123") === null);
    clearRemoteKeyCache();
    check(
        "remote-only clear preserves manual cache",
        remoteKeyCacheCounts().channels === 0
            && JSON.stringify(manualStore.keys) === JSON.stringify({ "123": { manualPasswordId: KEY } }),
    );

    let now = 1000;
    const deriveA = deferred<KdfDeriveResponse>();
    const revisionB = deferred<KdfRevisionResponse>();
    const callsByChannel: Record<string, number> = {};
    const fakeClient: RemoteKdfClient = {
        derive(channelId) {
            callsByChannel[channelId] = (callsByChannel[channelId] ?? 0) + 1;
            return deriveA.promise;
        },
        revision: () => revisionB.promise,
        abortAll() {},
        capabilities: () => ({ supported: true, boundingMode: "stream" }),
    };
    initRemoteKdf(manualStore, { clientFactory: () => fakeClient, now: () => now });
    saveRemoteConfiguration("https://cloud.example.test", TOKEN, false);
    setRemoteSessionKey("race-cloud-key");

    const pendingDerive = refreshRemoteChannel("123");
    const joinedDerive = refreshRemoteChannel("123");
    const pendingRevision = refreshRemoteRevision(true);
    revisionB.resolve({ version: 1, settingsRevision: revisions[1] });
    await pendingRevision;
    deriveA.resolve({ version: 1, settingsRevision: revisions[0], keys: [{ slot: 0, key: KEY }] });
    const staleCodes = await Promise.all([errorCode(pendingDerive), errorCode(joinedDerive)]);
    check(
        "revision-first completion blocks an older joined derive from cache/readiness resurrection",
        callsByChannel["123"] === 1
            && staleCodes[0] === "REMOTE_STALE"
            && staleCodes[1] === "REMOTE_STALE"
            && getRemoteSendKeys("123") === null
            && !remoteKdfStatus().ready,
    );

    const deriveFirstStore = JSON.parse(JSON.stringify(DEFAULTS)) as Settings;
    deriveFirstStore.remoteHost = "https://cloud.example.test";
    deriveFirstStore.remoteAuthToken = TOKEN;
    const deriveFirst = deferred<KdfDeriveResponse>();
    const revisionSecond = deferred<KdfRevisionResponse>();
    const deriveFirstClient: RemoteKdfClient = {
        derive: () => deriveFirst.promise,
        revision: () => revisionSecond.promise,
        abortAll() {},
        capabilities: () => ({ supported: true, boundingMode: "stream" }),
    };
    initSettings(deriveFirstStore);
    initRemoteKdf(deriveFirstStore, { clientFactory: () => deriveFirstClient, now: () => now });
    setRemoteSessionKey("derive-first-key");
    const firstDerivePromise = refreshRemoteChannel("123");
    const laterRevisionPromise = refreshRemoteRevision(true);
    deriveFirst.resolve({ version: 1, settingsRevision: revisions[0], keys: [{ slot: 0, key: KEY }] });
    await firstDerivePromise;
    const wasReady = remoteKdfStatus().ready && getRemoteSendKeys("123") !== null;
    revisionSecond.resolve({ version: 1, settingsRevision: revisions[1] });
    await laterRevisionPromise;
    check(
        "derive-first then newer revision completion demotes the derived keys and readiness",
        wasReady && getRemoteSendKeys("123") === null && !remoteKdfStatus().ready,
    );

    async function deriveRace(resolveSecondFirst: boolean): Promise<boolean> {
        const raceStore = JSON.parse(JSON.stringify(DEFAULTS)) as Settings;
        raceStore.remoteHost = "https://cloud.example.test";
        raceStore.remoteAuthToken = TOKEN;
        const byChannel: Record<string, ReturnType<typeof deferred<KdfDeriveResponse>>> = {
            "101": deferred<KdfDeriveResponse>(),
            "202": deferred<KdfDeriveResponse>(),
        };
        const raceClient: RemoteKdfClient = {
            derive: (channelId) => byChannel[channelId].promise,
            revision: async () => ({ version: 1, settingsRevision: revisions[0] }),
            abortAll() {},
            capabilities: () => ({ supported: true, boundingMode: "stream" }),
        };
        initSettings(raceStore);
        initRemoteKdf(raceStore, { clientFactory: () => raceClient, now: () => now });
        setRemoteSessionKey("derive-race-key");
        const first = refreshRemoteChannel("101");
        const second = refreshRemoteChannel("202");
        const firstResponse = { version: 1 as const, settingsRevision: revisions[0], keys: [{ slot: 0, key: KEY }] };
        const secondResponse = { version: 1 as const, settingsRevision: revisions[0], keys: [{ slot: 0, key: KEY }] };
        if (resolveSecondFirst) {
            byChannel["202"].resolve(secondResponse);
            const secondCode = await errorCode(second);
            byChannel["101"].resolve(firstResponse);
            const firstCode = await errorCode(first);
            return secondCode === "NO_ERROR" && firstCode === "REMOTE_STALE"
                && getRemoteSendKeys("202") !== null && getRemoteSendKeys("101") === null
                && remoteKdfStatus().ready;
        }
        byChannel["101"].resolve(firstResponse);
        const firstCode = await errorCode(first);
        byChannel["202"].resolve(secondResponse);
        const secondCode = await errorCode(second);
        return firstCode === "NO_ERROR" && secondCode === "REMOTE_STALE"
            && getRemoteSendKeys("101") !== null && getRemoteSendKeys("202") === null
            && remoteKdfStatus().ready;
    }
    check(
        "derive-vs-derive mutation epoch prevents overwrite in both completion orders",
        await deriveRace(false) && await deriveRace(true),
    );

    const generationStore = JSON.parse(JSON.stringify(DEFAULTS)) as Settings;
    const oldRequest = deferred<KdfDeriveResponse>();
    const newRequest = deferred<KdfDeriveResponse>();
    const seenSecrets: Array<{ origin: string; key: string }> = [];
    const generationFactory = (configuration: { origin: string }): RemoteKdfClient => ({
        derive: (_channelId, key) => {
            seenSecrets.push({ origin: configuration.origin, key });
            return configuration.origin.indexOf("old") >= 0 ? oldRequest.promise : newRequest.promise;
        },
        revision: async () => ({ version: 1, settingsRevision: revisions[0] }),
        abortAll() {},
        capabilities: () => ({ supported: true, boundingMode: "stream" }),
    });
    initSettings(generationStore);
    initRemoteKdf(generationStore, { clientFactory: generationFactory as any, now: () => now });
    saveRemoteConfiguration("https://old.example.test", TOKEN, false);
    setRemoteSessionKey("old-generation-key");
    const oldPending = refreshRemoteChannel("303");
    saveRemoteConfiguration("https://new.example.test", "abcdefabcdefabcdefabcdefabcdefab", false);
    const clearedAcrossConfig = !remoteKdfStatus().keyPresent;
    oldRequest.resolve({ version: 1, settingsRevision: revisions[0], keys: [{ slot: 0, key: KEY }] });
    const oldCode = await errorCode(oldPending);
    setRemoteSessionKey("new-generation-key");
    const newPending = refreshRemoteChannel("303");
    newRequest.resolve({ version: 1, settingsRevision: revisions[1], keys: [{ slot: 0, key: KEY }] });
    await newPending;
    check(
        "configuration generation clears the old key and rejects late old-origin completion",
        clearedAcrossConfig
            && oldCode === "REMOTE_STALE"
            && seenSecrets.length === 2
            && seenSecrets[0].origin === "https://old.example.test"
            && seenSecrets[0].key === "old-generation-key"
            && seenSecrets[1].origin === "https://new.example.test"
            && seenSecrets[1].key === "new-generation-key",
    );

    const secretStatus = JSON.stringify(remoteKdfStatus());
    const persistedGeneration = JSON.stringify(generationStore);
    check(
        "status and persistence redact the memory-only cloud key and response details",
        secretStatus.indexOf("new-generation-key") < 0
            && secretStatus.indexOf(TOKEN) < 0
            && secretStatus.indexOf("303") < 0
            && secretStatus.indexOf(revisions[1]) < 0
            && secretStatus.indexOf(KEY) < 0
            && persistedGeneration.indexOf("new-generation-key") < 0,
    );

    forgetRemoteConfiguration();
    check(
        "forget clears remote credentials, session, and cache while retaining manual settings",
        generationStore.remoteHost === ""
            && generationStore.remoteAuthToken === ""
            && !remoteKdfStatus().keyPresent
            && remoteKeyCacheCounts().channels === 0
            && generationStore.passwords === DEFAULTS.passwords
            && JSON.stringify(generationStore.keys) === JSON.stringify(DEFAULTS.keys),
    );

    let ttlNow = 10000;
    let revisionCallsCount = 0;
    let pendingRevisionCall = deferred<KdfRevisionResponse>();
    let useDeferredRevision = false;
    const ttlStore = JSON.parse(JSON.stringify(DEFAULTS)) as Settings;
    ttlStore.remoteHost = "https://cloud.example.test";
    ttlStore.remoteAuthToken = TOKEN;
    const ttlClient: RemoteKdfClient = {
        derive: async () => ({ version: 1, settingsRevision: REVISION, keys: [{ slot: 0, key: KEY }] }),
        revision() {
            revisionCallsCount++;
            return useDeferredRevision
                ? pendingRevisionCall.promise
                : Promise.resolve({ version: 1, settingsRevision: REVISION });
        },
        abortAll() {},
        capabilities: () => ({ supported: true, boundingMode: "stream" }),
    };
    initSettings(ttlStore);
    initRemoteKdf(ttlStore, { clientFactory: () => ttlClient, now: () => ttlNow });
    await ensureRemoteRevisionFresh();
    const firstCheckedAt = getRemoteRevisionCheckedAt();
    ttlNow += REMOTE_REVISION_TTL_MS - 1;
    await ensureRemoteRevisionFresh();
    const skippedWithinTtl = revisionCallsCount === 1;
    ttlNow += 1;
    useDeferredRevision = true;
    const ttlFirst = ensureRemoteRevisionFresh();
    const ttlJoined = ensureRemoteRevisionFresh();
    const coalesced = ttlFirst === ttlJoined && revisionCallsCount === 2;
    pendingRevisionCall.resolve({ version: 1, settingsRevision: REVISION });
    await Promise.all([ttlFirst, ttlJoined]);
    check(
        "revision freshness skips at 299999 ms, refreshes at 300000 ms, and coalesces",
        firstCheckedAt === 10000 && skippedWithinTtl && coalesced && getRemoteRevisionCheckedAt() === ttlNow,
    );

    const beforeFailureTime = getRemoteRevisionCheckedAt();
    pendingRevisionCall = deferred<KdfRevisionResponse>();
    const failedRevision = refreshRemoteRevision(true);
    pendingRevisionCall.reject(new RemoteKdfError("REMOTE_UNAVAILABLE"));
    check(
        "failed revision checks do not advance authoritative freshness",
        await errorCode(failedRevision) === "REMOTE_UNAVAILABLE"
            && getRemoteRevisionCheckedAt() === beforeFailureTime,
    );

    useDeferredRevision = true;
    pendingRevisionCall = deferred<KdfRevisionResponse>();
    const beforeLoadRefreshCalls = revisionCallsCount;
    refreshRemoteRevisionOnLoad();
    const loadRefreshForced = revisionCallsCount === beforeLoadRefreshCalls + 1;
    pendingRevisionCall.resolve({ version: 1, settingsRevision: REVISION });
    await Promise.resolve();
    await Promise.resolve();
    check("configured load refresh is forced even inside the TTL", loadRefreshForced);

    const repeatStore = JSON.parse(JSON.stringify(DEFAULTS)) as Settings;
    repeatStore.remoteHost = "https://cloud.example.test";
    repeatStore.remoteAuthToken = TOKEN;
    let repeatDerives = 0;
    let failNextDerive = false;
    const repeatClient: RemoteKdfClient = {
        derive: async () => {
            repeatDerives++;
            if (failNextDerive) throw new RemoteKdfError("KDF_FAILED");
            return { version: 1, settingsRevision: REVISION, keys: [{ slot: 0, key: KEY }] };
        },
        revision: async () => ({ version: 1, settingsRevision: REVISION }),
        abortAll() {},
        capabilities: () => ({ supported: true, boundingMode: "stream" }),
    };
    initSettings(repeatStore);
    initRemoteKdf(repeatStore, { clientFactory: () => repeatClient, now: () => ttlNow });
    const notReadyFromConfigOrKey = !remoteKdfStatus().ready;
    setRemoteSessionKey("repeat-session-key");
    const notReadyFromKeyAlone = !remoteKdfStatus().ready;
    await refreshRemoteChannel("909");
    const readyAfterStrictDerive = remoteKdfStatus().ready;
    await refreshRemoteChannel("909");
    failNextDerive = true;
    const failedDeriveCode = await errorCode(refreshRemoteChannel("909"));
    check(
        "readiness requires derive proof, repeat refreshes settle, and failure clears proof",
        notReadyFromConfigOrKey
            && notReadyFromKeyAlone
            && readyAfterStrictDerive
            && failedDeriveCode === "KDF_FAILED"
            && !remoteKdfStatus().ready
            && repeatDerives === 3,
    );

    const unloadStore = JSON.parse(JSON.stringify(DEFAULTS)) as Settings;
    unloadStore.remoteHost = "https://cloud.example.test";
    unloadStore.remoteAuthToken = TOKEN;
    const lateAfterUnload = deferred<KdfDeriveResponse>();
    let unloadAborts = 0;
    const unloadClient: RemoteKdfClient = {
        derive: () => lateAfterUnload.promise,
        revision: async () => ({ version: 1, settingsRevision: REVISION }),
        abortAll() {
            unloadAborts++;
        },
        capabilities: () => ({ supported: true, boundingMode: "stream" }),
    };
    initSettings(unloadStore);
    initRemoteKdf(unloadStore, { clientFactory: () => unloadClient, now: () => ttlNow });
    setRemoteSessionKey("unload-session-key");
    const unloadPending = refreshRemoteChannel("808");
    shutdownRemoteKdf();
    lateAfterUnload.resolve({ version: 1, settingsRevision: REVISION, keys: [{ slot: 0, key: KEY }] });
    check(
        "shutdown aborts, clears session readiness, and ignores late derive completion",
        unloadAborts > 0
            && await errorCode(unloadPending) === "REMOTE_STALE"
            && getRemoteSendKeys("808") === null
            && !remoteKdfStatus().keyPresent
            && !remoteKdfStatus().ready,
    );

    check("revision TTL constant is fixed", REMOTE_REVISION_TTL_MS === 300000);
    shutdownRemoteKdf();
}
