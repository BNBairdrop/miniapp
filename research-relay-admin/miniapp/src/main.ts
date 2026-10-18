import { Buffer } from 'buffer';
// @ton/core reads/writes use Node's Buffer; polyfill it for the browser.
(globalThis as any).Buffer = (globalThis as any).Buffer ?? Buffer;

import { TonConnectUI } from '@tonconnect/ui';
import { Address, beginCell, Cell } from '@ton/core';
import {
    OP,
    STANDARD_TRANSFER_OP,
    buildSweepBody,
    buildForwardJettonBody,
    buildRawRelayBody,
    buildUpdateConfigBody,
    buildSignedTriggerBody,
    buildTransferNotificationBody,
    cellToBase64Boc,
    toUserFriendly,
    hexToSignatureBuffer,
    configDictKeyForAddress,
    emptyConfigDict,
} from './relayOps';
import { initTelegram } from './telegram';
import { fetchRelayState } from './state';

// CHAIN.TESTNET per @tonconnect/sdk's enum (not re-exported from
// @tonconnect/ui, so pinned here as a literal with the source noted).
const TESTNET_CHAIN = '-3';

// --- Telegram gate: must run before anything else touches the DOM/wallet ---
const { allowed, reason } = initTelegram();
if (!allowed) {
    const lock = document.getElementById('lockScreen')!;
    const app = document.getElementById('app')!;
    document.getElementById('lockReason')!.textContent = reason ?? '';
    lock.classList.remove('hidden');
    app.classList.add('hidden');
    throw new Error(`access denied: ${reason}`);
}

const logEl = document.getElementById('log') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

function log(msg: string) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    logEl.textContent = `${line}\n${logEl.textContent}`;
}

const tonConnectUI = new TonConnectUI({
    manifestUrl: new URL('/tonconnect-manifest.json', window.location.href).toString(),
    buttonRootId: 'ton-connect-button',
});

tonConnectUI.onStatusChange((wallet) => {
    if (wallet) {
        const onTestnet = wallet.account.chain === TESTNET_CHAIN;
        statusEl.textContent = `connected: ${wallet.account.address} (chain ${wallet.account.chain}${onTestnet ? '' : ' — NOT TESTNET'})`;
        log(`wallet connected: ${wallet.account.address}, chain=${wallet.account.chain}`);
        if (!onTestnet) {
            log('WARNING: connected wallet is not on testnet. Every send() call below refuses to proceed until you reconnect a testnet wallet.');
        }
    } else {
        statusEl.textContent = 'not connected';
    }
});

function requireRelayAddress(): Address {
    const raw = (document.getElementById('relayAddr') as HTMLInputElement).value.trim();
    if (!raw) throw new Error('set the ResearchRelay address first');
    return Address.parse(raw);
}

function requireConnectedAddress(): Address {
    const acc = tonConnectUI.account;
    if (!acc) throw new Error('connect your wallet first');
    return Address.parse(acc.address);
}

function requireTestnet() {
    const acc = tonConnectUI.account;
    if (!acc) throw new Error('connect your wallet first');
    if (acc.chain !== TESTNET_CHAIN) {
        throw new Error(
            `refusing to send: connected wallet is on chain ${acc.chain}, not testnet (${TESTNET_CHAIN}). This panel is testnet-only.`
        );
    }
}

async function send(relay: Address, body: Cell, valueNano: bigint) {
    requireTestnet();
    const relayUserFriendly = toUserFriendly(relay, { testnet: true });
    log(`sending op to ${relayUserFriendly}, value=${valueNano} nanoton, body=${cellToBase64Boc(body).slice(0, 24)}...`);
    const result = await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [
            {
                address: relayUserFriendly,
                amount: valueNano.toString(),
                payload: cellToBase64Boc(body),
            },
        ],
    });
    log(`wallet accepted and signed the request. boc: ${('boc' in result ? result.boc : '').slice(0, 24)}...`);
    return result;
}

function wireButton(id: string, handler: () => Promise<void>) {
    const btn = document.getElementById(id) as HTMLButtonElement;
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
            await handler();
        } catch (e: any) {
            log(`ERROR: ${e?.message ?? e}`);
        } finally {
            btn.disabled = false;
        }
    });
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();

/**
 * Both signature-gated ops check `check_signature(cell_hash(beginCell()
 * .store_slice(sender_address).end_cell()), signature, pubkey)` where
 * `sender_address` is whoever's wallet sends the message — i.e. your
 * connected wallet. Logs that hash so you can sign it offline with the
 * matching secret key (see README.md) and paste the signature back in.
 */
function logSignHash(forOp: string) {
    const addr = requireConnectedAddress();
    const hash = beginCell().storeAddress(addr).endCell().hash();
    log(`${forOp}: hash to sign offline for sender ${toUserFriendly(addr, { testnet: true })} = ${hash.toString('hex')}`);
}

wireButton('btnSweep', async () => {
    const relay = requireRelayAddress();
    const sendMode = parseInt(val('sweepMode'), 10);
    const body = buildSweepBody(sendMode);
    await send(relay, body, 50000000n);
});

wireButton('btnForwardJetton', async () => {
    const relay = requireRelayAddress();
    const body = buildForwardJettonBody({
        queryId: BigInt(Date.now()),
        amount: BigInt(val('fwdAmount') || '0'),
        jettonWalletAddr: Address.parse(val('fwdJettonWallet')),
        destination: Address.parse(val('fwdDest')),
    });
    await send(relay, body, 100000000n);
});

wireButton('btnRawRelay', async () => {
    const relay = requireRelayAddress();
    const hex = val('rawBodyHex');
    const innerBody = hex ? Cell.fromBoc(Buffer.from(hex.replace(/^0x/i, ''), 'hex'))[0] : new Cell();
    const body = buildRawRelayBody({
        dest: Address.parse(val('rawDest')),
        value: BigInt(val('rawValue') || '0'),
        sendMode: parseInt(val('rawMode'), 10),
        body: innerBody,
    });
    await send(relay, body, 100000000n);
});

wireButton('btnUpdateConfig', async () => {
    const relay = requireRelayAddress();
    const allowListRaw = val('cfgAllowList');
    let dict: ReturnType<typeof emptyConfigDict> | null = null;
    if (allowListRaw) {
        dict = emptyConfigDict();
        for (const part of allowListRaw.split(',').map((s) => s.trim()).filter(Boolean)) {
            dict.set(configDictKeyForAddress(Address.parse(part)), true);
        }
    }
    const body = buildUpdateConfigBody({
        newOwner: Address.parse(val('cfgNewOwner')),
        newConfigDict: dict,
        newFlag: val('cfgFlag').toLowerCase() === 'true',
    });
    await send(relay, body, 50000000n);
});

wireButton('btnSignedTrigger', async () => {
    const relay = requireRelayAddress();
    logSignHash('op::0xabcdef13 / op::0x7362d09c');
    const signature = hexToSignatureBuffer(val('trigSigHex'));
    const body = buildSignedTriggerBody({
        queryId: BigInt(val('trigQueryId') || '0'),
        signature,
        forwardTarget: Address.parse(val('trigForwardTarget')),
    });
    await send(relay, body, 100000000n);
});

wireButton('btnTransferNotif', async () => {
    const relay = requireRelayAddress();
    logSignHash('op::0x7362d09c');
    const sigHex = val('tnSigHex');
    // An intentionally-empty/garbage 64-byte buffer forces the signature
    // check to fail, i.e. exercises the unauthorized/fallback path on
    // purpose — useful for testing the redirect/config_dict behavior.
    const signature = sigHex ? hexToSignatureBuffer(sigHex) : Buffer.alloc(64, 0);
    const redirectRaw = val('tnRedirect');
    const body = buildTransferNotificationBody({
        queryId: BigInt(val('tnQueryId') || '0'),
        amount: BigInt(val('tnAmount') || '0'),
        fromAddress: Address.parse(val('tnFromAddress')),
        signature,
        redirectAddress: redirectRaw ? Address.parse(redirectRaw) : null,
    });
    await send(relay, body, 100000000n);
});

// --- read-only state panel --------------------------------------------------

function renderState(grid: HTMLElement, pairs: [string, string][]) {
    grid.innerHTML = '';
    for (const [k, v] of pairs) {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        grid.appendChild(dt);
        grid.appendChild(dd);
    }
}

wireButton('btnRefreshState', async () => {
    const relay = requireRelayAddress();
    const apiKey = val('apiKey') || undefined;
    const grid = document.getElementById('stateGrid') as HTMLElement;
    renderState(grid, [['status', 'loading...']]);
    const state = await fetchRelayState(relay, apiKey);
    renderState(grid, [
        ['balance', `${state.balanceNano} nanoton`],
        ['owner_address', toUserFriendly(state.ownerAddress, { testnet: true })],
        ['pubkey', state.pubkeyHex],
        ['flag', String(state.flag)],
        ['config_dict', state.hasConfigDict ? 'present' : 'empty/null'],
    ]);
    log(`state refreshed for ${toUserFriendly(relay, { testnet: true })}`);
});

log('ready. Connect your testnet wallet and set the ResearchRelay address above.');
log(`your connected address (once connected) is what hash(sender_address) must be signed against for op::${OP.SIGNED_TRIGGER.toString(16)} and op::${OP.TRANSFER_NOTIFICATION.toString(16)}.`);
log(`standard TEP-74 transfer op for reference: 0x${STANDARD_TRANSFER_OP.toString(16)}`);
