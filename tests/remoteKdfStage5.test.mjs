/**
 * Stage 5 cross-repository acceptance bridge. This deliberately runs under Bun
 * from the sibling workspace so the real server Worker can feed keys into the
 * unchanged mobile message pipeline without becoming a standalone mobile test
 * dependency.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { loadConfig } from "../../goofcord-cloudserver/src/config.ts";
import { createKdfWorkerPool } from "../../goofcord-cloudserver/src/kdf/pool.ts";
import { createRemoteKdfService } from "../../goofcord-cloudserver/src/kdf/service.ts";
import { createApplication } from "../../goofcord-cloudserver/src/runtime/application.ts";
import { createReadiness } from "../../goofcord-cloudserver/src/runtime/readiness.ts";
import { createSecurity } from "../../goofcord-cloudserver/src/security/index.ts";
import { createRemoteKdfClient } from "../src/cloud/client.ts";
import { parseDeriveResponse } from "../src/cloud/contracts.ts";
import { decryptWithRemoteKeys, parseCloakedPayload } from "../src/core/decrypt.ts";
import { encryptWithKey } from "../src/core/encrypt.ts";
import { fromBase64 } from "../src/util/base64.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";
const ACCOUNT_ID = "account-stage5";
const ORIGIN = "https://service.test";
const PLAINTEXT = "Stage 5 public synthetic round trip 🔐";

function fixture(path) {
    return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
}

function fixedRandom(length) {
    const out = new Uint8Array(length);
    for (let i = 0; i < out.length; i++) out[i] = (i * 17 + 3) & 0xff;
    return out;
}

test("derives a committed GoofCord blob through the real server and mobile pipeline", async () => {
    const cloudFixture = fixture("../../goofcord-cloudserver/test/fixtures/remoteKdf/cloud-blobs-v1.json");
    const vectorFixture = fixture("./fixtures/remoteKdf/argon2id-v1.json");
    if (
        cloudFixture?.version !== 1
        || typeof cloudFixture?.encrypted?.blob !== "string"
        || typeof cloudFixture?.encrypted?.cloudEncryptionKey !== "string"
        || vectorFixture?.version !== 1
        || typeof vectorFixture?.channelId !== "string"
        || typeof vectorFixture?.keyBase64 !== "string"
    ) {
        throw new Error("STAGE5_FIXTURE_INVALID");
    }

    let authCalls = 0;
    let settingsLoads = 0;
    let unexpectedWrites = 0;
    let fetchCalls = 0;
    let rawAuthorizationMatched = false;
    let authenticatedAccountLoaded = false;

    const unexpectedWrite = async () => {
        unexpectedWrites++;
        throw new Error("STAGE5_UNEXPECTED_WRITE");
    };
    const auth = {
        authenticate: unexpectedWrite,
        authenticateReadOnly: async (rawAuthorization) => {
            authCalls++;
            rawAuthorizationMatched = rawAuthorization === TOKEN;
            return rawAuthorizationMatched
                ? { userId: ACCOUNT_ID, tokenHash: "a".repeat(64) }
                : null;
        },
        createSession: unexpectedWrite,
        revokeAllSessions: unexpectedWrite,
    };
    const settings = {
        save: unexpectedWrite,
        load: async (accountId) => {
            settingsLoads++;
            authenticatedAccountLoaded = accountId === ACCOUNT_ID;
            return authenticatedAccountLoaded ? cloudFixture.encrypted.blob : null;
        },
        deleteForUser: unexpectedWrite,
    };
    const oauth = {
        authorizationUrl: () => "https://discord.com/oauth2/authorize",
        userIdForCode: async () => ({ kind: "invalid_code" }),
    };
    const config = loadConfig({
        CLIENT_ID: "stage5-client-id",
        CLIENT_SECRET: "stage5-client-secret",
        REDIRECT_URI: "http://localhost:3000",
        MONGO_URI: "mongodb://127.0.0.1:27017/stage5-test",
    });
    const readiness = createReadiness();
    readiness.markReady();
    const pool = createKdfWorkerPool({ capacity: 1, jobTimeoutMs: 30000 });
    const kdf = createRemoteKdfService(pool);
    let client;

    try {
        await kdf.initialize();
        const app = createApplication({
            clientId: config.clientId,
            auth,
            settings,
            oauth,
            security: createSecurity(config),
            kdf,
            readiness,
            mongoConnection: { readyState: 1 },
        });
        client = createRemoteKdfClient(
            { origin: ORIGIN, token: TOKEN },
            {
                fetchFn: async (input, init) => {
                    fetchCalls++;
                    if (String(input) !== `${ORIGIN}/v2/kdf/derive`) {
                        throw new Error("STAGE5_UNEXPECTED_PATH");
                    }
                    return app.fetch(new Request(String(input), init), {
                        directPeerAddress: "198.51.100.10",
                    });
                },
            },
        );
        expect(
            client.capabilities().supported
            && client.capabilities().boundingMode === "stream",
        ).toBe(true);

        const response = await client.derive(
            vectorFixture.channelId,
            cloudFixture.encrypted.cloudEncryptionKey,
        );
        const strict = parseDeriveResponse(response);
        expect(strict.ok).toBe(true);
        if (!strict.ok) throw new Error("STAGE5_RESPONSE_INVALID");

        const slots = strict.value.keys.map((entry) => entry.slot);
        expect(slots).toEqual([0, 1]);
        expect(strict.value.keys[0].key === vectorFixture.keyBase64).toBe(true);
        expect(strict.value.keys[0].key !== strict.value.keys[1].key).toBe(true);
        expect(
            fetchCalls === 1
            && authCalls === 1
            && settingsLoads === 1
            && rawAuthorizationMatched
            && authenticatedAccountLoaded
            && unexpectedWrites === 0,
        ).toBe(true);

        const keys = strict.value.keys.map((entry) => Uint8Array.from(fromBase64(entry.key)));
        const ciphertext = encryptWithKey(PLAINTEXT, keys[1], "public fixture cover", fixedRandom);
        const parsed = parseCloakedPayload(ciphertext);
        expect(parsed !== null).toBe(true);
        if (!parsed) throw new Error("STAGE5_PAYLOAD_INVALID");

        const decrypted = decryptWithRemoteKeys(parsed, [{
            settingsRevision: strict.value.settingsRevision,
            keys,
        }]);
        expect(decrypted?.text === PLAINTEXT).toBe(true);
    } finally {
        try {
            client?.abortAll();
        } finally {
            await kdf.close();
        }
    }
}, 90_000);
