// Thin wrapper around the Telegram WebApp JS bridge (loaded via the
// <script src="https://telegram.org/js/telegram-web-app.js"> tag in
// index.html — official Telegram Mini Apps bridge, not something to bundle
// via npm). See https://core.telegram.org/bots/webapps#initializing-mini-apps
//
// IMPORTANT: `initDataUnsafe` is exactly what its name says — unsafe/unverified
// on the client. A real access-control decision (if this ever stops being
// "just me") has to verify `initData`'s HMAC server-side with the bot token.
// Since this panel is for your own private use, the client-side user-id
// check below is a tripwire against an accidentally-shared link, not a
// security boundary by itself.

export type TelegramWebApp = {
    ready: () => void;
    expand: () => void;
    colorScheme: 'light' | 'dark';
    themeParams: Record<string, string>;
    initData: string;
    initDataUnsafe: {
        user?: { id: number; username?: string; first_name?: string };
        [k: string]: unknown;
    };
    MainButton: {
        setText: (t: string) => void;
        show: () => void;
        hide: () => void;
        onClick: (cb: () => void) => void;
    };
    BackButton: { show: () => void; hide: () => void; onClick: (cb: () => void) => void };
    showAlert?: (msg: string) => void;
    showConfirm?: (msg: string, cb: (ok: boolean) => void) => void;
};

export function getTelegramWebApp(): TelegramWebApp | null {
    const w = window as any;
    return w.Telegram?.WebApp ?? null;
}

/**
 * Set this to your own numeric Telegram user id (visible via @userinfobot,
 * or by logging `tg.initDataUnsafe.user.id` once) to restrict the panel to
 * yourself. Leave the array empty to skip the check entirely (e.g. while
 * testing outside Telegram, where initDataUnsafe.user is never populated).
 */
export const ALLOWED_TELEGRAM_USER_IDS: number[] = [
    // 123456789,
];

export function initTelegram(): { tg: TelegramWebApp | null; allowed: boolean; reason?: string } {
    const tg = getTelegramWebApp();
    if (!tg) {
        // Not running inside Telegram (plain browser tab) — allow it, since
        // that's also how you'd open this during local development.
        return { tg: null, allowed: true, reason: 'not running inside Telegram' };
    }

    tg.ready();
    tg.expand();
    applyTelegramTheme(tg);

    if (ALLOWED_TELEGRAM_USER_IDS.length === 0) {
        return { tg, allowed: true, reason: 'no allow-list configured' };
    }

    const uid = tg.initDataUnsafe?.user?.id;
    if (uid != null && ALLOWED_TELEGRAM_USER_IDS.includes(uid)) {
        return { tg, allowed: true };
    }
    return { tg, allowed: false, reason: `telegram user id ${uid ?? '(unknown)'} is not in ALLOWED_TELEGRAM_USER_IDS` };
}

function applyTelegramTheme(tg: TelegramWebApp) {
    const root = document.documentElement.style;
    const map: Record<string, string> = {
        bg_color: '--tg-bg',
        text_color: '--tg-text',
        hint_color: '--tg-hint',
        link_color: '--tg-link',
        button_color: '--tg-button',
        button_text_color: '--tg-button-text',
        secondary_bg_color: '--tg-secondary-bg',
    };
    for (const [tgKey, cssVar] of Object.entries(map)) {
        const v = tg.themeParams?.[tgKey];
        if (v) root.setProperty(cssVar, v);
    }
}
