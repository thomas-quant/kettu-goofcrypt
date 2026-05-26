/**
 * Lazy Metro module lookups + a robust toast helper. Everything is resolved on
 * first use (modules may not exist at plugin-eval time).
 */

let _msgActions: any;
export function MessageActions(): any {
    return (_msgActions ??= bunny.metro.findByProps("sendMessage", "editMessage"));
}

let _channelStore: any;
export function getCurrentChannelId(): string | undefined {
    _channelStore ??= bunny.metro.findByProps("getChannelId", "getLastSelectedChannelId");
    try {
        return _channelStore?.getChannelId?.();
    } catch {
        return undefined;
    }
}

let _toasts: any;
export function showToast(text: string): void {
    try {
        if (bunny.ui?.toasts?.showToast) return bunny.ui.toasts.showToast(text);
        _toasts ??= bunny.metro.findByProps("open", "close");
        if (_toasts?.open) return _toasts.open({ content: text, source: null });
    } catch {
        /* fall through */
    }
    try {
        bunny.plugin.logger.log("[GoofCrypt toast]", text);
    } catch {
        /* ignore */
    }
}
