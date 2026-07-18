/** Deterministic Stage 4 remote-KDF cold-path and Discord wiring checks. */
import { aeadEncrypt } from "../src/crypto/aead";
import { encryptWithKey, MessageTooLongError } from "../src/core/encrypt";
import {
    decryptWithCachedKeys,
    decryptWithRemoteKeys,
    parseCloakedPayload,
    type ParsedCloakedPayload,
} from "../src/core/decrypt";
import { frame } from "../src/core/payload";
import {
    clearMemory,
    initKeyCache,
    passwordId,
} from "../src/core/keycache";
import {
    applyRemoteRevision,
    getRemoteDecryptKeySets,
    getRemoteSendKey,
    initRemoteKeyCache,
    storeRemoteDerivedKeys,
} from "../src/core/remoteKeycache";
import { conceal, ZWC } from "../src/stego/zwc";
import {
    DEFAULTS,
    initSettings,
    keySource,
    remoteSendSlot,
    setKeySource,
    setRemoteSendSlot,
    type Settings,
} from "../src/settings";
import { fromBase64, toBase64 } from "../src/util/base64";
import {
    REMOTE_FAILURE_COOLDOWN_MS,
    clearRemoteSessionKey,
    ensureRemoteChannelKeys,
    getFreshRemoteSendKey,
    initRemoteKdf,
    invalidateRemoteOperations,
    prepareRemoteSend,
    refreshRemoteChannel,
    remoteKdfStatus,
    setRemoteSessionKey,
    shutdownRemoteKdf,
} from "../src/cloud/remoteKdf";
import {
    REMOTE_CLIENT_ERROR_CODES,
    RemoteKdfError,
    type RemoteKdfClient,
} from "../src/cloud/client";
import {
    KDF_ERROR_CODES,
    type KdfDeriveResponse,
} from "../src/cloud/contracts";
import {
    MAX_REMOTE_WAITING_MESSAGES_PER_OPERATION,
    changeKeySource,
    createRemoteColdPath,
    type RemoteMessageSnapshot,
} from "../src/discord/remoteColdPath";
import { createFluxHandler } from "../src/discord/flux";
import {
    registerSendPatches,
    type SendPatchDependencies,
} from "../src/discord/send";

export type Stage4Check = (name: string, condition: boolean, detail?: string) => void;

const CHANNEL = "1234567890123456789";
const REVISION_A = "A".repeat(43);
const REVISION_B = "B".repeat(43);
const MANUAL_PASSWORD = "stage4-manual-password";
const KEY_A = Uint8Array.from({ length: 32 }, (_unused, i) => i + 1);
const KEY_B = Uint8Array.from({ length: 32 }, (_unused, i) => 255 - i);
const KEY_C = fromBase64("WNRTGTkvrju+EwmAg1mCEem36E040hCwFKVkROLN6AQ=");
const TOKEN = "0123456789abcdef0123456789abcdef";

function fixedRng(n: number): Uint8Array {
    return Uint8Array.from({ length: n }, (_unused, i) => (i * 13 + 7) & 0xff);
}

function freshStore(): Settings {
    return JSON.parse(JSON.stringify(DEFAULTS)) as Settings;
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

async function remoteCode(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
        return "NO_ERROR";
    } catch (error) {
        return error instanceof RemoteKdfError ? error.code : "WRONG_ERROR";
    }
}

function deriveResponse(revision: string, keys: Uint8Array[] = [KEY_A]): KdfDeriveResponse {
    return {
        version: 1,
        settingsRevision: revision,
        keys: keys.map((key, slot) => ({ slot, key: toBase64(key) })),
    };
}

export async function runRemoteKdfStage4Checks(check: Stage4Check): Promise<void> {
    console.log("\n[14] Remote KDF Stage 4 mode and hot-path primitives");

    const preStage4: any = JSON.parse(JSON.stringify(DEFAULTS));
    delete preStage4.keySource;
    delete preStage4.remoteSendSlot;
    preStage4.passwords = "manual-one,manual-two";
    preStage4.chosenIndex = 1;
    preStage4.keys = { "77": { manualId: toBase64(KEY_A) } };
    preStage4.remoteHost = "https://cloud.example.test";
    preStage4.remoteAuthToken = "0123456789abcdef0123456789abcdef";
    preStage4.remoteKeyCache = { version: 1, channels: {} };
    const preserved = JSON.stringify({
        passwords: preStage4.passwords,
        chosenIndex: preStage4.chosenIndex,
        keys: preStage4.keys,
        remoteHost: preStage4.remoteHost,
        remoteAuthToken: preStage4.remoteAuthToken,
        remoteKeyCache: preStage4.remoteKeyCache,
        enabled: preStage4.enabled,
    });
    initSettings(preStage4);
    check(
        "pre-Stage4 storage migrates only absent mode/slot to manual/zero",
        keySource() === "manual"
            && remoteSendSlot() === 0
            && preserved === JSON.stringify({
                passwords: preStage4.passwords,
                chosenIndex: preStage4.chosenIndex,
                keys: preStage4.keys,
                remoteHost: preStage4.remoteHost,
                remoteAuthToken: preStage4.remoteAuthToken,
                remoteKeyCache: preStage4.remoteKeyCache,
                enabled: preStage4.enabled,
            }),
    );

    const invalidStore: any = freshStore();
    invalidStore.keySource = undefined;
    invalidStore.remoteSendSlot = 9;
    initSettings(invalidStore);
    check(
        "present invalid mode/slot remain fail-closed rather than defaulting",
        Object.prototype.hasOwnProperty.call(invalidStore, "keySource")
            && keySource() === null
            && remoteSendSlot() === null,
    );
    check(
        "strict mode/slot setters accept exact bounds and preserve state on rejection",
        setKeySource("remote")
            && setRemoteSendSlot(7)
            && !setKeySource("REMOTE")
            && !setRemoteSendSlot(8)
            && keySource() === "remote"
            && remoteSendSlot() === 7,
    );

    let nullWrites = 0;
    const nullHostile = new Proxy({} as Settings, {
        set(target, property, value) {
            if (value === null) {
                nullWrites++;
                throw new TypeError("null-hostile proxy");
            }
            return Reflect.set(target, property, value);
        },
    });
    initSettings(nullHostile);
    check(
        "mode migration writes primitives only through null-hostile storage",
        nullWrites === 0 && keySource() === "manual" && remoteSendSlot() === 0,
    );

    const minimum = new Uint8Array(41);
    minimum[0] = 1;
    const wrongVersion = Uint8Array.from(minimum);
    wrongVersion[0] = 2;
    check(
        "structural parser rejects plain, lone-ZWC, short, and wrong-version content",
        parseCloakedPayload("ordinary cover") === null
            && parseCloakedPayload(ZWC[0]) === null
            && parseCloakedPayload(conceal(new Uint8Array(40))) === null
            && parseCloakedPayload(conceal(wrongVersion)) === null,
    );
    const minimumParsed = parseCloakedPayload(conceal(minimum));
    check(
        "structural parser accepts the exact supported minimum frame",
        minimumParsed !== null
            && minimumParsed.nonce.length === 24
            && minimumParsed.ctAndTag.length === 16,
    );

    const manualStore = freshStore();
    manualStore.passwords = MANUAL_PASSWORD;
    manualStore.keys = {
        [CHANNEL]: { [passwordId(MANUAL_PASSWORD)]: toBase64(KEY_C) },
    };
    initSettings(manualStore);
    initKeyCache(manualStore);
    clearMemory();
    const manualCiphertext = encryptWithKey("manual cached regression", KEY_C, "normal cover words", fixedRng);
    const manualResult = decryptWithCachedKeys(manualCiphertext, CHANNEL, [MANUAL_PASSWORD]);
    check(
        "manual cached decryption keeps winner-compatible behavior after parser refactor",
        manualResult?.text === "manual cached regression" && manualResult.password === MANUAL_PASSWORD,
    );

    const remoteStore = freshStore();
    initRemoteKeyCache(remoteStore);
    storeRemoteDerivedKeys(CHANNEL, {
        version: 1,
        settingsRevision: REVISION_A,
        keys: [
            { slot: 0, key: toBase64(KEY_A) },
            { slot: 1, key: toBase64(KEY_B) },
        ],
    }, 10);
    const slotOne = getRemoteSendKey(CHANNEL, 1);
    if (slotOne) slotOne[0] = 0;
    check(
        "selected current send key is exact, copied, and strictly bounded",
        getRemoteSendKey(CHANNEL, 1)?.[0] === KEY_B[0]
            && getRemoteSendKey(CHANNEL, -1) === null
            && getRemoteSendKey(CHANNEL, 2) === null
            && getRemoteSendKey(CHANNEL, 1.5) === null,
    );

    const slotOneCiphertext = encryptWithKey("remote slot one", KEY_B, "remote cover words", fixedRng);
    const slotOneParsed = parseCloakedPayload(slotOneCiphertext);
    const slotOneResult = slotOneParsed
        ? decryptWithRemoteKeys(slotOneParsed, getRemoteDecryptKeySets(CHANNEL))
        : null;
    check(
        "remote hot decrypt preserves current multi-slot server order",
        slotOneResult?.text === "remote slot one",
    );

    storeRemoteDerivedKeys(CHANNEL, {
        version: 1,
        settingsRevision: REVISION_B,
        keys: [{ slot: 0, key: toBase64(KEY_A) }],
    }, 20);
    const historicalResult = slotOneParsed
        ? decryptWithRemoteKeys(slotOneParsed, getRemoteDecryptKeySets(CHANNEL))
        : null;
    check(
        "remote decrypt falls back newest-to-oldest while old keys cannot send",
        historicalResult?.text === "remote slot one"
            && getRemoteDecryptKeySets(CHANNEL).length === 2
            && getRemoteSendKey(CHANNEL, 1) === null,
    );
    applyRemoteRevision({ version: 1, settingsRevision: "C".repeat(43) }, 30);
    check("demoted current data cannot send", getRemoteSendKey(CHANNEL, 0) === null);

    const nonce = fixedRng(24);
    const corrupt = conceal(frame(nonce, aeadEncrypt(KEY_A, nonce, Uint8Array.from([1, 2, 3, 4]))));
    const corruptParsed = parseCloakedPayload(corrupt);
    check(
        "authenticated corrupt plaintext is not misreported as a remote key miss success",
        corruptParsed !== null
            && decryptWithRemoteKeys(corruptParsed, [{ settingsRevision: REVISION_B, keys: [KEY_A, KEY_B] }]) === null,
    );

    console.log("\n[15] Remote KDF Stage 4 shared preparation, cooldown, and invalidation");

    let now = 1000;
    let revisionCalls = 0;
    const derives: Record<string, ReturnType<typeof deferred<KdfDeriveResponse>>> = {};
    const deriveCalls: Record<string, number> = {};
    const sharedClient: RemoteKdfClient = {
        derive(channelId) {
            deriveCalls[channelId] = (deriveCalls[channelId] ?? 0) + 1;
            return (derives[channelId] ??= deferred<KdfDeriveResponse>()).promise;
        },
        revision: async () => {
            revisionCalls++;
            return { version: 1, settingsRevision: REVISION_A };
        },
        abortAll() {},
        capabilities: () => ({ supported: true, boundingMode: "stream" }),
    };
    const sharedStore = freshStore();
    sharedStore.remoteHost = "https://cloud.example.test";
    sharedStore.remoteAuthToken = TOKEN;
    initSettings(sharedStore);
    initRemoteKdf(sharedStore, { clientFactory: () => sharedClient, now: () => now });
    setRemoteSessionKey("stage4-shared-cloud-key");
    applyRemoteRevision({ version: 1, settingsRevision: REVISION_A }, now);

    const firstShared = ensureRemoteChannelKeys("101");
    const secondShared = ensureRemoteChannelKeys("101");
    check(
        "same generation/revision/channel returns the exact same derive Promise",
        firstShared === secondShared && deriveCalls["101"] === 1,
    );
    derives["101"].resolve(deriveResponse(REVISION_A, [KEY_A, KEY_B]));
    await firstShared;
    check(
        "successful shared derive installs ordered current keys",
        getFreshRemoteSendKey("101", 1)?.[0] === KEY_B[0],
    );

    const incomingShared = ensureRemoteChannelKeys("102");
    const outgoingShared = prepareRemoteSend("102", 0);
    await Promise.resolve();
    await Promise.resolve();
    check(
        "simultaneous incoming and outgoing preparation share one derive request",
        deriveCalls["102"] === 1,
    );
    derives["102"].resolve(deriveResponse(REVISION_A));
    await Promise.all([incomingShared, outgoingShared]);

    const rapidIncoming = ensureRemoteChannelKeys("103");
    const rapidSends: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) rapidSends.push(prepareRemoteSend("103", 0));
    await Promise.resolve();
    await Promise.resolve();
    let sameRapidPreparation = true;
    for (let i = 1; i < rapidSends.length; i++) {
        if (rapidSends[i] !== rapidSends[0]) sameRapidPreparation = false;
    }
    check(
        "twenty rapid sends plus incoming work share one preparation and derive",
        sameRapidPreparation && deriveCalls["103"] === 1,
    );
    derives["103"].resolve(deriveResponse(REVISION_A));
    await Promise.all([rapidIncoming, ...rapidSends]);

    const revisionCallsBeforeTtl = revisionCalls;
    now += 300000;
    check("stale revision makes synchronous send lookup fail closed", getFreshRemoteSendKey("101", 0) === null);
    await prepareRemoteSend("101", 0);
    check(
        "stale cached send performs revision-first refresh without redundant derive",
        revisionCalls === revisionCallsBeforeTtl + 1 && deriveCalls["101"] === 1 && getFreshRemoteSendKey("101", 0) !== null,
    );
    shutdownRemoteKdf();

    let policyDerives = 0;
    const changedRevisionClient: RemoteKdfClient = {
        derive: async () => {
            policyDerives++;
            return deriveResponse(REVISION_B, [KEY_B]);
        },
        revision: async () => ({ version: 1, settingsRevision: REVISION_B }),
        abortAll() {},
        capabilities: () => ({ supported: true, boundingMode: "stream" }),
    };
    const changedRevisionStore = freshStore();
    changedRevisionStore.remoteHost = "https://cloud.example.test";
    changedRevisionStore.remoteAuthToken = TOKEN;
    initSettings(changedRevisionStore);
    initRemoteKdf(changedRevisionStore, { clientFactory: () => changedRevisionClient, now: () => 300000 });
    setRemoteSessionKey("stage4-policy-cloud-key");
    storeRemoteDerivedKeys("104", deriveResponse(REVISION_A, [KEY_A]), 0);
    await prepareRemoteSend("104", 0);
    const changedSets = getRemoteDecryptKeySets("104");
    check(
        "changed revision globally demotes old send data and derives the selected current key",
        policyDerives === 1
            && getFreshRemoteSendKey("104", 0)?.[0] === KEY_B[0]
            && changedSets.length === 2
            && changedSets[0].settingsRevision === REVISION_B
            && changedSets[1].settingsRevision === REVISION_A,
    );
    shutdownRemoteKdf();

    let refusedDerives = 0;
    const failedRevisionClient: RemoteKdfClient = {
        derive: async () => {
            refusedDerives++;
            return deriveResponse(REVISION_A);
        },
        revision: async () => {
            throw new RemoteKdfError("REMOTE_TIMEOUT");
        },
        abortAll() {},
        capabilities: () => ({ supported: true, boundingMode: "stream" }),
    };
    const failedRevisionStore = freshStore();
    failedRevisionStore.remoteHost = "https://cloud.example.test";
    failedRevisionStore.remoteAuthToken = TOKEN;
    initSettings(failedRevisionStore);
    initRemoteKdf(failedRevisionStore, { clientFactory: () => failedRevisionClient, now: () => 300000 });
    setRemoteSessionKey("stage4-revision-failure-key");
    storeRemoteDerivedKeys("105", deriveResponse(REVISION_A), 0);
    const failedRevisionCode = await remoteCode(prepareRemoteSend("105", 0));
    check(
        "revision failure refuses a stale cached send key without deriving or cooling down",
        failedRevisionCode === "REMOTE_TIMEOUT"
            && refusedDerives === 0
            && getFreshRemoteSendKey("105", 0) === null
            && remoteKdfStatus().cooldowns === 0,
    );
    shutdownRemoteKdf();

    let slotDerives = 0;
    const missingSlotClient: RemoteKdfClient = {
        derive: async () => {
            slotDerives++;
            return deriveResponse(REVISION_A, [KEY_A]);
        },
        revision: async () => ({ version: 1, settingsRevision: REVISION_A }),
        abortAll() {},
        capabilities: () => ({ supported: true, boundingMode: "stream" }),
    };
    const missingSlotStore = freshStore();
    missingSlotStore.remoteHost = "https://cloud.example.test";
    missingSlotStore.remoteAuthToken = TOKEN;
    initSettings(missingSlotStore);
    initRemoteKdf(missingSlotStore, { clientFactory: () => missingSlotClient, now: () => 1000 });
    setRemoteSessionKey("stage4-slot-cloud-key");
    const missingSlotCode = await remoteCode(prepareRemoteSend("106", 1));
    check(
        "successful derive still rejects an unavailable selected slot without substituting slot zero",
        missingSlotCode === "REMOTE_SLOT_UNAVAILABLE"
            && slotDerives === 1
            && getFreshRemoteSendKey("106", 0)?.[0] === KEY_A[0]
            && getFreshRemoteSendKey("106", 1) === null,
    );
    shutdownRemoteKdf();

    let cooldownNow = 0;
    const cooldownDerives: Record<string, number> = {};
    let transportSupported = true;
    const cooldownClient: RemoteKdfClient = {
        derive: async (channelId) => {
            cooldownDerives[channelId] = (cooldownDerives[channelId] ?? 0) + 1;
            if (cooldownDerives[channelId] === 1) throw new RemoteKdfError("KDF_BUSY");
            return deriveResponse(REVISION_A);
        },
        revision: async () => ({ version: 1, settingsRevision: REVISION_A }),
        abortAll() {},
        capabilities: () => transportSupported
            ? { supported: true, boundingMode: "stream" }
            : { supported: false, boundingMode: "unsupported" },
    };
    const cooldownStore = freshStore();
    cooldownStore.remoteHost = "https://cloud.example.test";
    cooldownStore.remoteAuthToken = TOKEN;
    initSettings(cooldownStore);
    initRemoteKdf(cooldownStore, { clientFactory: () => cooldownClient, now: () => cooldownNow });
    setRemoteSessionKey("stage4-cooldown-cloud-key");
    applyRemoteRevision({ version: 1, settingsRevision: REVISION_A }, cooldownNow);
    const firstFailure = await remoteCode(ensureRemoteChannelKeys("201"));
    const immediateCooldown = await remoteCode(ensureRemoteChannelKeys("201"));
    cooldownNow = 29999;
    const finalCooldown = await remoteCode(ensureRemoteChannelKeys("201"));
    cooldownNow = 30000;
    const afterCooldown = await remoteCode(ensureRemoteChannelKeys("201"));
    check(
        "actual derive failures cool down at 0/29999 and retry at 30000 ms",
        REMOTE_FAILURE_COOLDOWN_MS === 30000
            && firstFailure === "KDF_BUSY"
            && immediateCooldown === "REMOTE_COOLDOWN"
            && finalCooldown === "REMOTE_COOLDOWN"
            && afterCooldown === "NO_ERROR"
            && cooldownDerives["201"] === 2,
    );

    cooldownNow = 40000;
    const bypassFailure = await remoteCode(ensureRemoteChannelKeys("202"));
    const bypassCooldown = await remoteCode(ensureRemoteChannelKeys("202"));
    const bypassRefresh = await remoteCode(refreshRemoteChannel("202"));
    check(
        "explicit channel refresh bypasses cooldown while identical active work still coalesces",
        bypassFailure === "KDF_BUSY"
            && bypassCooldown === "REMOTE_COOLDOWN"
            && bypassRefresh === "NO_ERROR"
            && cooldownDerives["202"] === 2
            && remoteKdfStatus().cooldowns === 0,
    );

    clearRemoteSessionKey();
    const missingKeyCode = await remoteCode(ensureRemoteChannelKeys("203"));
    setRemoteSessionKey("stage4-cooldown-cloud-key");
    transportSupported = false;
    const unsupportedCode = await remoteCode(ensureRemoteChannelKeys("204"));
    check(
        "local missing-key and unsupported failures never create derive cooldowns",
        missingKeyCode === "REMOTE_KEY_REQUIRED"
            && unsupportedCode === "REMOTE_UNSUPPORTED"
            && remoteKdfStatus().cooldowns === 0
            && cooldownDerives["203"] === undefined
            && cooldownDerives["204"] === undefined,
    );
    shutdownRemoteKdf();

    let invalidationNow = 5000;
    let invalidationAborts = 0;
    let invalidationCalls = 0;
    const lateDerive = deferred<KdfDeriveResponse>();
    const freshDerive = deferred<KdfDeriveResponse>();
    const invalidationClient: RemoteKdfClient = {
        derive(channelId) {
            invalidationCalls++;
            if (channelId === "302") return Promise.reject(new RemoteKdfError("KDF_BUSY"));
            if (channelId === "301" && invalidationCalls > 3) return freshDerive.promise;
            if (channelId === "301") return lateDerive.promise;
            return Promise.resolve(deriveResponse(REVISION_A));
        },
        revision: async () => ({ version: 1, settingsRevision: REVISION_A }),
        abortAll() {
            invalidationAborts++;
        },
        capabilities: () => ({ supported: true, boundingMode: "stream" }),
    };
    const invalidationStore = freshStore();
    invalidationStore.remoteHost = "https://cloud.example.test";
    invalidationStore.remoteAuthToken = TOKEN;
    initSettings(invalidationStore);
    initRemoteKdf(invalidationStore, { clientFactory: () => invalidationClient, now: () => invalidationNow });
    setRemoteSessionKey("stage4-preserved-cloud-key");
    applyRemoteRevision({ version: 1, settingsRevision: REVISION_A }, invalidationNow);
    await remoteCode(ensureRemoteChannelKeys("302"));
    await ensureRemoteChannelKeys("300");
    const oldPending = ensureRemoteChannelKeys("301");
    const cacheBeforeInvalidation = JSON.stringify(invalidationStore.remoteKeyCache);
    const configBeforeInvalidation = JSON.stringify({
        host: invalidationStore.remoteHost,
        token: invalidationStore.remoteAuthToken,
        keys: invalidationStore.keys,
    });
    const statusBeforeInvalidation = remoteKdfStatus();
    invalidateRemoteOperations();
    const statusAfterInvalidation = remoteKdfStatus();
    lateDerive.resolve(deriveResponse(REVISION_A, [KEY_B]));
    const lateCode = await remoteCode(oldPending);
    check(
        "mode invalidation aborts and clears volatile state while preserving secrets/config/caches",
        statusBeforeInvalidation.ready
            && statusBeforeInvalidation.pendingOperations > 0
            && statusBeforeInvalidation.cooldowns > 0
            && invalidationAborts > 0
            && statusAfterInvalidation.pendingOperations === 0
            && statusAfterInvalidation.cooldowns === 0
            && !statusAfterInvalidation.ready
            && statusAfterInvalidation.keyPresent
            && cacheBeforeInvalidation === JSON.stringify(invalidationStore.remoteKeyCache)
            && configBeforeInvalidation === JSON.stringify({
                host: invalidationStore.remoteHost,
                token: invalidationStore.remoteAuthToken,
                keys: invalidationStore.keys,
            })
            && lateCode === "REMOTE_STALE"
            && getRemoteSendKey("301", 0) === null,
    );
    const newPending = ensureRemoteChannelKeys("301");
    check("switching back starts a fresh operation", newPending !== oldPending);
    freshDerive.resolve(deriveResponse(REVISION_A, [KEY_B]));
    await newPending;
    check("fresh post-invalidation work can commit", getRemoteSendKey("301", 0)?.[0] === KEY_B[0]);
    shutdownRemoteKdf();

    console.log("\n[16] Remote KDF Stage 4 exact waiting and notification coordinator");

    const incomingDeferred = deferred<unknown>();
    const snapshotsSeen: RemoteMessageSnapshot[] = [];
    const dispatched: unknown[] = [];
    const toasts: string[] = [];
    let mode: "manual" | "remote" | null = "remote";
    let ensureCalls = 0;
    const sendDeferred = deferred<void>();
    const sendArgs: Array<[string, number]> = [];
    const cold = createRemoteColdPath({
        ensureKeys() {
            ensureCalls++;
            return incomingDeferred.promise;
        },
        prepareSend(channelId, slot) {
            sendArgs.push([channelId, slot]);
            return sendDeferred.promise;
        },
        decrypt(snapshot) {
            snapshotsSeen.push(snapshot);
            return snapshot.ciphertext === "new-ciphertext" ? "decrypted" : null;
        },
        mark: () => "LOCK ",
        dispatch: (action) => dispatched.push(action),
        toast: (text) => toasts.push(text),
        mode: () => mode,
    });
    const firstQueue = cold.queueIncoming({ messageId: "m1", channelId: "401", ciphertext: "old-ciphertext" });
    const duplicateQueue = cold.queueIncoming({ messageId: "m1", channelId: "401", ciphertext: "new-ciphertext" });
    cold.queueIncoming({ messageId: "m2", channelId: "401", ciphertext: "still-locked" });
    check(
        "incoming waiters join one Promise and replace duplicate IDs with newest exact snapshot",
        firstQueue === "started" && duplicateQueue === "joined" && cold.status().waitingMessages === 2,
    );
    incomingDeferred.resolve(undefined);
    await incomingDeferred.promise;
    await Promise.resolve();
    check(
        "successful retry emits only the frozen minimal MESSAGE_UPDATE shape",
        snapshotsSeen.length === 2
            && JSON.stringify(Object.keys(snapshotsSeen[0]).sort()) === JSON.stringify(["channelId", "ciphertext", "messageId"])
            && snapshotsSeen[0].ciphertext === "new-ciphertext"
            && JSON.stringify(dispatched) === JSON.stringify([{
                type: "MESSAGE_UPDATE",
                channelId: "401",
                message: { id: "m1", channel_id: "401", content: "LOCK decrypted" },
            }]),
    );

    const batchDeferred = deferred<unknown>();
    const batchSeen: RemoteMessageSnapshot[] = [];
    const batchDispatches: unknown[] = [];
    const batch = createRemoteColdPath({
        ensureKeys: () => batchDeferred.promise,
        prepareSend: async () => undefined,
        decrypt(snapshot) {
            batchSeen.push(snapshot);
            return snapshot.messageId === "batch-24" ? null : `plain-${snapshot.messageId}`;
        },
        mark: () => "BATCH ",
        dispatch: (action) => batchDispatches.push(action),
        toast: () => undefined,
        mode: () => "remote",
    });
    for (let i = 0; i < 50; i++) {
        batch.queueIncoming({
            messageId: `batch-${i % 25}`,
            channelId: "409",
            ciphertext: `cipher-${i}`,
        });
    }
    const batchWaiting = batch.status().waitingMessages;
    batchDeferred.resolve(undefined);
    await batchDeferred.promise;
    await Promise.resolve();
    let batchExact = batchSeen.length === 25 && batchDispatches.length === 24;
    for (let i = 0; i < batchSeen.length; i++) {
        const snapshot = batchSeen[i];
        const expectedCiphertext = `cipher-${25 + Number(snapshot.messageId.slice("batch-".length))}`;
        const keys = Object.keys(snapshot).sort();
        if (
            JSON.stringify(keys) !== JSON.stringify(["channelId", "ciphertext", "messageId"])
            || snapshot.channelId !== "409"
            || snapshot.ciphertext !== expectedCiphertext
        ) {
            batchExact = false;
        }
    }
    check(
        "fifty mixed duplicate waiters retain only newest exact snapshots and dispatch each decryptable ID once",
        batchWaiting === 25 && batchExact,
    );
    batch.shutdown();

    const sendFirst = cold.queueSend("401", 1);
    const sendJoined = cold.queueSend("401", 1);
    check(
        "outgoing coordinator accepts only channel/slot and owns one preparation observer",
        cold.queueSend.length === 2
            && sendFirst === "started"
            && sendJoined === "joined"
            && JSON.stringify(sendArgs) === JSON.stringify([["401", 1]])
            && toasts.length === 0,
    );
    sendDeferred.resolve();
    await sendDeferred.promise;
    await Promise.resolve();
    check("preparation completion produces one resend notice and no replay surface", toasts.length === 1);

    let safeFailureMessages = true;
    const safeCodes = [...KDF_ERROR_CODES, ...REMOTE_CLIENT_ERROR_CODES];
    for (let i = 0; i < safeCodes.length; i++) {
        const messages: string[] = [];
        const failed = createRemoteColdPath({
            ensureKeys: async () => undefined,
            prepareSend: () => Promise.reject(new RemoteKdfError(safeCodes[i])),
            decrypt: () => null,
            mark: () => "",
            dispatch: () => undefined,
            toast: (text) => messages.push(text),
            mode: () => "remote",
        });
        failed.queueSend(String(700 + i), 0);
        await Promise.resolve();
        await Promise.resolve();
        if (messages.length !== 1 || messages[0].indexOf("secret-marker") >= 0 || messages[0].indexOf("undefined") >= 0) {
            safeFailureMessages = false;
        }
        failed.shutdown();
    }
    const unknownFailureMessages: string[] = [];
    const unknownFailure = createRemoteColdPath({
        ensureKeys: async () => undefined,
        prepareSend: () => Promise.reject(new Error("secret-marker-caught-detail")),
        decrypt: () => null,
        mark: () => "",
        dispatch: () => undefined,
        toast: (text) => unknownFailureMessages.push(text),
        mode: () => "remote",
    });
    unknownFailure.queueSend("799", 0);
    await Promise.resolve();
    await Promise.resolve();
    check(
        "every stable and unknown preparation failure maps to one non-reflective safe notice",
        safeFailureMessages
            && unknownFailureMessages.length === 1
            && unknownFailureMessages[0].indexOf("secret-marker") < 0,
    );
    unknownFailure.shutdown();

    const boundDeferred = deferred<unknown>();
    let uniqueRemoteStarts = 0;
    const bound = createRemoteColdPath({
        ensureKeys: () => {
            uniqueRemoteStarts = 1;
            return boundDeferred.promise;
        },
        prepareSend: async () => undefined,
        decrypt: () => null,
        mark: () => "",
        dispatch: () => undefined,
        toast: () => undefined,
        mode: () => "remote",
    });
    for (let i = 0; i < MAX_REMOTE_WAITING_MESSAGES_PER_OPERATION; i++) {
        bound.queueIncoming({ messageId: `bound-${i}`, channelId: "402", ciphertext: "ciphertext" });
    }
    const overflow = bound.queueIncoming({ messageId: "bound-overflow", channelId: "402", ciphertext: "ciphertext" });
    check(
        "waiting snapshots stop exactly at the frozen bound without another remote operation",
        MAX_REMOTE_WAITING_MESSAGES_PER_OPERATION === 200
            && bound.status().waitingMessages === 200
            && overflow === "overflow"
            && uniqueRemoteStarts === 1,
    );
    bound.reset();
    boundDeferred.resolve(undefined);
    await boundDeferred.promise;
    await Promise.resolve();
    check("reset suppresses late incoming work and clears aggregate state", bound.status().waitingMessages === 0);
    bound.shutdown();
    cold.shutdown();

    console.log("\n[17] Remote KDF Stage 4 Flux and instead-patch wiring");

    let fluxMode: "manual" | "remote" | null = null;
    let manualDecryptCalls = 0;
    let manualStartCalls = 0;
    let remoteParseCalls = 0;
    let remoteDecryptCalls = 0;
    let remotePlaintext: string | null = null;
    const queuedSnapshots: RemoteMessageSnapshot[] = [];
    const completedIds = new Set<string>();
    const parsedFixture = minimumParsed as ParsedCloakedPayload;
    const fluxHandler = createFluxHandler({
        mode: () => fluxMode,
        mark: () => "MARK ",
        isCloaked: () => true,
        manualDecrypt: () => {
            manualDecryptCalls++;
            return { text: "manual-plain", password: MANUAL_PASSWORD };
        },
        startManual: () => {
            manualStartCalls++;
        },
        parseRemote(content) {
            remoteParseCalls++;
            return content === "malformed" ? null : parsedFixture;
        },
        remoteDecrypt: () => {
            remoteDecryptCalls++;
            return remotePlaintext === null ? null : { text: remotePlaintext };
        },
        queueRemote: (snapshot) => {
            queuedSnapshots.push(snapshot);
        },
        hasCompleted: (id) => completedIds.has(id),
        rememberCompleted: (id) => completedIds.add(id),
    });

    const invalidIncoming = { id: "f0", channel_id: "500", content: "ciphertext" };
    fluxHandler({ type: "MESSAGE_CREATE", channelId: "500", message: invalidIncoming });
    check(
        "invalid key source leaves incoming ciphertext without manual or remote work",
        invalidIncoming.content === "ciphertext"
            && manualDecryptCalls === 0
            && manualStartCalls === 0
            && remoteParseCalls === 0
            && remoteDecryptCalls === 0
            && queuedSnapshots.length === 0,
    );

    fluxMode = "remote";
    const malformedIncoming = { id: "f1", channel_id: "501", content: "malformed" };
    fluxHandler({ type: "MESSAGE_UPDATE", message: malformedIncoming });
    check(
        "remote structural rejection creates no waiter",
        malformedIncoming.content === "malformed" && remoteParseCalls === 1 && queuedSnapshots.length === 0,
    );

    remotePlaintext = "hot-plain";
    const hotIncoming = { id: "f2", channel_id: "wrong-fallback", content: "hot-ciphertext", extra: "not-retained" };
    fluxHandler({ type: "MESSAGE_CREATE", channelId: "502", message: hotIncoming });
    check(
        "remote hot hit mutates synchronously and marks before redispatch re-entry",
        hotIncoming.content === "MARK hot-plain" && completedIds.has("f2") && queuedSnapshots.length === 0,
    );
    fluxHandler({ type: "MESSAGE_UPDATE", channelId: "502", message: hotIncoming });
    check("completed message ID suppresses re-entry", remoteDecryptCalls === 1);

    remotePlaintext = null;
    fluxHandler({
        type: "MESSAGE_CREATE",
        channelId: "503",
        message: { id: "f3", channel_id: "ignored-fallback", content: "create-ciphertext", extra: "drop" },
    });
    fluxHandler({
        type: "MESSAGE_UPDATE",
        message: { id: "f4", channel_id: "504", content: "update-ciphertext", extra: "drop" },
    });
    fluxHandler({
        type: "LOAD_MESSAGES_SUCCESS",
        channelId: "505",
        messages: [
            { id: "f5", channel_id: "ignored-history-fallback", content: "history-top", extra: "drop" },
            { id: "f6", channel_id: "506", content: "history-fallback", extra: "drop" },
        ],
    });
    check(
        "CREATE/UPDATE/history normalize exact snapshots with top-level then message fallback",
        JSON.stringify(queuedSnapshots) === JSON.stringify([
            { messageId: "f3", channelId: "503", ciphertext: "create-ciphertext" },
            { messageId: "f4", channelId: "504", ciphertext: "update-ciphertext" },
            { messageId: "f5", channelId: "505", ciphertext: "history-top" },
            { messageId: "f6", channelId: "505", ciphertext: "history-fallback" },
        ]),
    );

    fluxMode = "manual";
    const manualIncoming = { id: "f7", channel_id: "507", content: "manual-ciphertext" };
    const remoteCallsBeforeManual = remoteParseCalls + remoteDecryptCalls + queuedSnapshots.length;
    fluxHandler({ type: "MESSAGE_CREATE", message: manualIncoming });
    check(
        "manual mode remains distinct and never calls remote primitives",
        manualIncoming.content === "MARK manual-plain"
            && manualDecryptCalls === 1
            && manualStartCalls === 0
            && remoteCallsBeforeManual === remoteParseCalls + remoteDecryptCalls + queuedSnapshots.length,
    );
    const editPayload = { type: "MESSAGE_START_EDIT", content: "MARK editable" };
    fluxHandler(editPayload);
    check("MESSAGE_START_EDIT still strips the display mark", editPayload.content === "editable");

    type CapturedPatch = (this: unknown, args: any[], orig: Function) => unknown;
    const captured: Record<string, CapturedPatch> = {};
    let beforeRegistrations = 0;
    const fakePatcher = {
        instead(name: string, _parent: unknown, callback: CapturedPatch) {
            captured[name] = callback;
            return () => undefined;
        },
        before() {
            beforeRegistrations++;
            return () => undefined;
        },
    };
    const fakeActions = {
        sendMessage() {},
        editMessage() {},
    };
    let sendMode: "manual" | "remote" | null = "remote";
    let sendSlot: number | null = 1;
    let remoteKey: Uint8Array | null = null;
    let manualKey: Uint8Array | null = KEY_A;
    let manualGetterCalls = 0;
    let remoteGetterCalls = 0;
    let manualWarmCalls = 0;
    let remoteQueueCalls = 0;
    let origCalls = 0;
    const sendToasts: string[] = [];
    const preparation = deferred<void>();
    let preparationSettled = false;
    void preparation.promise.then(() => {
        preparationSettled = true;
    });
    const sendDependencies: SendPatchDependencies = {
        enabled: () => true,
        mode: () => sendMode,
        remoteSlot: () => sendSlot,
        cover: () => "cover",
        isCloaked: () => false,
        manualPassword: () => {
            manualGetterCalls++;
            return MANUAL_PASSWORD;
        },
        manualKey: () => {
            manualGetterCalls++;
            return manualKey;
        },
        warmManual: () => {
            manualWarmCalls++;
        },
        remoteKey: () => {
            remoteGetterCalls++;
            return remoteKey;
        },
        queueRemote: (channelId, slot) => {
            remoteQueueCalls++;
            sendArgs.push([channelId, slot]);
        },
        encrypt: (content) => `encrypted:${content}`,
        toast: (text) => sendToasts.push(text),
        noteAbort: () => undefined,
    };
    registerSendPatches(fakePatcher, fakeActions, sendDependencies);
    check(
        "production registration seam installs send/edit with instead and never before",
        beforeRegistrations === 0 && typeof captured.sendMessage === "function" && typeof captured.editMessage === "function",
    );

    const coldMessage = { content: "keep-this-text" };
    const coldReturn = captured.sendMessage.call({}, ["601", coldMessage], () => {
        origCalls++;
    });
    const coldCode = await remoteCode(coldReturn as Promise<unknown>);
    check(
        "cold instead callback rejects before deferred preparation and never retains/replays text",
        coldReturn !== preparation.promise
            && coldCode === "REMOTE_SEND_REJECTED"
            && !preparationSettled
            && origCalls === 0
            && remoteQueueCalls === 1
            && coldMessage.content === "keep-this-text",
    );
    preparation.resolve();
    await preparation.promise;
    await Promise.resolve();
    check("preparation resolution cannot invoke orig", origCalls === 0 && coldMessage.content === "keep-this-text");

    const rapidDeferred = deferred<unknown>();
    const rapidNotices: string[] = [];
    const rapidPatchToasts: string[] = [];
    const rapidDispatches: unknown[] = [];
    let rapidPrepareCalls = 0;
    let rapidEnsureCalls = 0;
    let rapidOrigCalls = 0;
    const rapidCold = createRemoteColdPath({
        ensureKeys: () => {
            rapidEnsureCalls++;
            return rapidDeferred.promise;
        },
        prepareSend: () => {
            rapidPrepareCalls++;
            return rapidDeferred.promise;
        },
        decrypt: () => "rapid-incoming-plain",
        mark: () => "RAPID ",
        dispatch: (action) => rapidDispatches.push(action),
        toast: (text) => rapidNotices.push(text),
        mode: () => "remote",
    });
    const rapidCaptured: Record<string, CapturedPatch> = {};
    registerSendPatches({
        instead(name, _parent, callback) {
            rapidCaptured[name] = callback;
            return () => undefined;
        },
    }, fakeActions, {
        ...sendDependencies,
        mode: () => "remote",
        remoteSlot: () => 0,
        remoteKey: () => null,
        queueRemote: (channelId, slot) => {
            rapidCold.queueSend(channelId, slot);
        },
        toast: (text) => rapidPatchToasts.push(text),
    });
    const rapidMessages: Array<{ content: string }> = [];
    const rapidRejections: Promise<unknown>[] = [];
    for (let i = 0; i < 20; i++) {
        const message = { content: `rapid-text-${i}` };
        rapidMessages.push(message);
        rapidRejections.push(rapidCaptured.sendMessage.call({}, ["609", message], () => {
            rapidOrigCalls++;
        }) as Promise<unknown>);
    }
    rapidCold.queueIncoming({ messageId: "rapid-incoming", channelId: "609", ciphertext: "rapid-ciphertext" });
    const rapidCodes = await Promise.all(rapidRejections.map(remoteCode));
    const rapidBeforeResolution = rapidCold.status();
    rapidDeferred.resolve(undefined);
    await rapidDeferred.promise;
    await Promise.resolve();
    let rapidTextsKept = true;
    for (let i = 0; i < rapidMessages.length; i++) {
        if (rapidMessages[i].content !== `rapid-text-${i}`) rapidTextsKept = false;
    }
    check(
        "twenty intercepted cold sends plus one incoming miss reject immediately and share bounded completion",
        rapidCodes.every((code) => code === "REMOTE_SEND_REJECTED")
            && rapidTextsKept
            && rapidOrigCalls === 0
            && rapidPrepareCalls === 1
            && rapidEnsureCalls === 1
            && rapidBeforeResolution.sendPreparations === 1
            && rapidBeforeResolution.incomingOperations === 1
            && rapidNotices.length === 1
            && rapidPatchToasts.length === 20
            && rapidDispatches.length === 1,
    );
    rapidCold.shutdown();

    const countersBeforeInvalid = () => ({
        manualGetterCalls,
        remoteGetterCalls,
        manualWarmCalls,
        remoteQueueCalls,
        origCalls,
    });
    sendMode = null;
    sendSlot = 1;
    const beforeInvalidMode = countersBeforeInvalid();
    const toastsBeforeInvalidMode = sendToasts.length;
    const invalidModeMessage = { content: "invalid-mode-text" };
    const invalidModeCode = await remoteCode(captured.sendMessage.call({}, ["602", invalidModeMessage], () => {
        origCalls++;
    }) as Promise<unknown>);
    const afterInvalidMode = countersBeforeInvalid();
    const toastsAfterInvalidMode = sendToasts.length;
    sendMode = "remote";
    sendSlot = null;
    const beforeInvalidSlot = countersBeforeInvalid();
    const toastsBeforeInvalidSlot = sendToasts.length;
    const invalidSlotMessage = { content: "invalid-slot-text" };
    const invalidSlotCode = await remoteCode(captured.sendMessage.call({}, ["603", invalidSlotMessage], () => {
        origCalls++;
    }) as Promise<unknown>);
    const afterInvalidSlot = countersBeforeInvalid();
    const toastsAfterInvalidSlot = sendToasts.length;
    check(
        "invalid mode/slot are inert fixed rejections with byte-identical content",
        invalidModeCode === "REMOTE_SEND_REJECTED"
            && invalidSlotCode === "REMOTE_SEND_REJECTED"
            && JSON.stringify(beforeInvalidMode) === JSON.stringify(afterInvalidMode)
            && JSON.stringify(beforeInvalidSlot) === JSON.stringify(afterInvalidSlot)
            && toastsAfterInvalidMode === toastsBeforeInvalidMode + 1
            && toastsAfterInvalidSlot === toastsBeforeInvalidSlot + 1
            && sendToasts[toastsBeforeInvalidMode].indexOf("invalid message mode or remote slot") >= 0
            && sendToasts[toastsBeforeInvalidMode].indexOf("invalid-mode-text") < 0
            && sendToasts[toastsBeforeInvalidSlot].indexOf("invalid-slot-text") < 0
            && invalidModeMessage.content === "invalid-mode-text"
            && invalidSlotMessage.content === "invalid-slot-text",
    );

    sendMode = "remote";
    sendSlot = 1;
    remoteKey = KEY_B;
    const resendMessage = { content: "explicit-resend" };
    const resendReturn = captured.sendMessage.call({}, ["604", resendMessage], () => {
        origCalls++;
        return "sent";
    });
    check(
        "fresh selected remote key encrypts and explicit resend alone calls orig once",
        resendReturn === "sent" && resendMessage.content === "encrypted:explicit-resend" && origCalls === 1,
    );

    sendMode = "manual";
    sendSlot = 0;
    remoteKey = null;
    const remoteGettersBeforeManualSend = remoteGetterCalls + remoteQueueCalls;
    const manualMessage = { content: "manual-send" };
    captured.sendMessage.call({}, ["605", manualMessage], () => {
        origCalls++;
        return "manual-sent";
    });
    check(
        "manual send behavior remains separate from all remote APIs",
        manualMessage.content === "encrypted:manual-send"
            && manualGetterCalls >= 2
            && manualWarmCalls === 0
            && remoteGettersBeforeManualSend === remoteGetterCalls + remoteQueueCalls,
    );

    sendMode = "remote";
    sendSlot = 0;
    remoteKey = KEY_A;
    sendDependencies.encrypt = () => {
        throw new MessageTooLongError(2001);
    };
    const longMessage = { content: "too-long" };
    const origBeforeLong = origCalls;
    await remoteCode(captured.editMessage.call({}, ["606", "message-id", longMessage], () => {
        origCalls++;
    }) as Promise<unknown>);
    check(
        "edit-message encryption failure rejects without orig and retains text",
        origCalls === origBeforeLong && longMessage.content === "too-long",
    );

    sendDependencies.encrypt = () => {
        throw new Error("rng unavailable test detail");
    };
    const rngMessage = { content: "rng-kept" };
    const origBeforeRng = origCalls;
    const toastsBeforeRng = sendToasts.length;
    let rngRejected = false;
    try {
        await (captured.sendMessage.call({}, ["607", rngMessage], () => {
            origCalls++;
        }) as Promise<unknown>);
    } catch {
        rngRejected = true;
    }
    check(
        "RNG/encryption failure rejects without orig, mutation, or reflected detail",
        rngRejected
            && origCalls === origBeforeRng
            && rngMessage.content === "rng-kept"
            && sendToasts.length === toastsBeforeRng + 1
            && sendToasts[toastsBeforeRng].indexOf("rng unavailable test detail") < 0,
    );

    const modeSwitchLate = deferred<KdfDeriveResponse>();
    let modeSwitchAborts = 0;
    const modeSwitchStore = freshStore();
    modeSwitchStore.keySource = "remote";
    modeSwitchStore.remoteHost = "https://cloud.example.test";
    modeSwitchStore.remoteAuthToken = TOKEN;
    const modeSwitchClient: RemoteKdfClient = {
        derive: () => modeSwitchLate.promise,
        revision: async () => ({ version: 1, settingsRevision: REVISION_A }),
        abortAll: () => {
            modeSwitchAborts++;
        },
        capabilities: () => ({ supported: true, boundingMode: "stream" }),
    };
    initSettings(modeSwitchStore);
    initRemoteKdf(modeSwitchStore, { clientFactory: () => modeSwitchClient, now: () => 9000 });
    setRemoteSessionKey("mode-switch-preserved-key");
    applyRemoteRevision({ version: 1, settingsRevision: REVISION_A }, 9000);
    remoteKdfStatus(); // canonicalize the persisted cache envelope before comparison
    const modeSwitchCache = JSON.stringify(modeSwitchStore.remoteKeyCache);
    const modeSwitchPending = ensureRemoteChannelKeys("901");
    const lateColdDispatches: unknown[] = [];
    const lateColdToasts: string[] = [];
    const lateCold = createRemoteColdPath({
        ensureKeys: () => modeSwitchPending,
        prepareSend: () => modeSwitchPending,
        decrypt: () => "must-not-dispatch",
        mark: () => "LATE ",
        dispatch: (action) => lateColdDispatches.push(action),
        toast: (text) => lateColdToasts.push(text),
        mode: keySource,
    });
    lateCold.queueIncoming({ messageId: "late-mode", channelId: "901", ciphertext: "late-ciphertext" });
    lateCold.queueSend("901", 0);
    const changedMode = changeKeySource("manual");
    modeSwitchLate.resolve(deriveResponse(REVISION_A));
    const modeSwitchCode = await remoteCode(modeSwitchPending);
    await Promise.resolve();
    const modeSwitchStatus = remoteKdfStatus();
    const modeSwitchPreserved = JSON.stringify(modeSwitchStore.remoteKeyCache) === modeSwitchCache;
    const lateColdStatus = lateCold.status();
    check(
        "official mode helper resets/invalidate-gates work while preserving configuration, session, and cache",
        changedMode
            && keySource() === "manual"
            && modeSwitchAborts > 0
            && modeSwitchCode === "REMOTE_STALE"
            && modeSwitchStatus.keyPresent
            && modeSwitchStatus.pendingOperations === 0
            && modeSwitchStatus.cooldowns === 0
            && modeSwitchStore.remoteHost === "https://cloud.example.test"
            && modeSwitchStore.remoteAuthToken === TOKEN
            && modeSwitchPreserved
            && lateColdDispatches.length === 0
            && lateColdToasts.length === 0
            && lateColdStatus.incomingOperations === 0
            && lateColdStatus.sendPreparations === 0,
        JSON.stringify({
            changedMode,
            mode: keySource(),
            aborts: modeSwitchAborts,
            code: modeSwitchCode,
            keyPresent: modeSwitchStatus.keyPresent,
            pending: modeSwitchStatus.pendingOperations,
            cooldowns: modeSwitchStatus.cooldowns,
            host: modeSwitchStore.remoteHost === "https://cloud.example.test",
            token: modeSwitchStore.remoteAuthToken === TOKEN,
            cache: modeSwitchPreserved,
        }),
    );
    const switchedBack = changeKeySource("remote");
    const freshModePending = ensureRemoteChannelKeys("901");
    const freshModeCode = await remoteCode(freshModePending);
    check(
        "switching back after a mode change starts fresh committable work",
        switchedBack
            && freshModePending !== modeSwitchPending
            && freshModeCode === "NO_ERROR"
            && getRemoteSendKey("901", 0)?.[0] === KEY_A[0],
    );
    lateCold.shutdown();
    shutdownRemoteKdf();

    clearMemory();
}
