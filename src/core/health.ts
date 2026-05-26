/**
 * Lightweight error counters surfaced on demand via /encrypt status, so silent
 * failures (swallowed in hot paths) are still visible without spamming toasts.
 */
export const health = {
    deriveFails: 0,
    decryptCorrupt: 0,
    sendAborts: 0,
    lastError: "",
};

export function noteError(kind: keyof typeof health, e?: unknown): void {
    if (kind === "lastError") return;
    (health[kind] as number)++;
    if (e) health.lastError = (e as Error)?.message ?? String(e);
}

/** Compact summary appended to status when anything is non-zero. */
export function healthSummary(): string {
    const { deriveFails, decryptCorrupt, sendAborts } = health;
    if (!deriveFails && !decryptCorrupt && !sendAborts) return "";
    return ` · errs: derive ${deriveFails}/corrupt ${decryptCorrupt}/abort ${sendAborts}`;
}
