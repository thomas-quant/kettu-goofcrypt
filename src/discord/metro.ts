/**
 * Metro lookups + toast helper, against the Vendetta API. Resolved lazily on
 * first use.
 */

let _msgActions: any;
export function MessageActions(): any {
    // The canonical MessageActions module (has sendMessage + sendBotMessage +
    // editMessage). Fall back to a single-prop lookup like Kettu's messagefix.
    return (_msgActions ??=
        vendetta.metro.findByProps("sendMessage", "sendBotMessage") ?? vendetta.metro.findByProps("sendMessage"));
}

export function FluxDispatcher(): any {
    return vendetta.metro.common.FluxDispatcher;
}

export function getCurrentChannelId(): string | undefined {
    try {
        return vendetta.metro.common.channels?.getChannelId?.();
    } catch {
        return undefined;
    }
}

export function showToast(text: string): void {
    try {
        vendetta.ui.toasts.showToast(text);
    } catch {
        try {
            vendetta.logger.log("[GoofCrypt]", text);
        } catch {
            /* ignore */
        }
    }
}
