// Reads ResearchRelay's on-chain state via TON Center's public testnet REST
// API and parses the raw storage cell client-side, matching load_data() in
// reconstructed_drainer_relay.fc exactly:
//
//   slice owner_address = ds~load_msg_addr();
//   int pubkey           = ds~load_uint(256);
//   int flag              = ds~load_int(1);
//   cell config_dict      = ds~load_dict();   // Maybe ^Cell
//
// We parse storage ourselves instead of calling a get-method because this
// contract doesn't expose one for its own state (only the fake
// get_nft_data() stub) — confirmed by reading the .fc source directly.
//
// API shape (https://testnet.toncenter.com/api/v2/) verified against its
// published openapi.json: GET /getAddressInformation?address=... returns a
// TonlibResponse whose `result` includes `balance` (nanotons, string) and
// `data` (base64 BoC of the raw data cell) when the account is deployed.

import { Address, Cell } from '@ton/core';

const TONCENTER_TESTNET_BASE = 'https://testnet.toncenter.com/api/v2';

export type RelayState = {
    balanceNano: bigint;
    ownerAddress: Address;
    pubkeyHex: string;
    flag: boolean;
    hasConfigDict: boolean;
};

export async function fetchRelayState(address: Address, apiKey?: string): Promise<RelayState> {
    const url = new URL(`${TONCENTER_TESTNET_BASE}/getAddressInformation`);
    url.searchParams.set('address', address.toString({ urlSafe: true, bounceable: true, testOnly: true }));
    if (apiKey) url.searchParams.set('api_key', apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
        throw new Error(`toncenter getAddressInformation failed: HTTP ${res.status}`);
    }
    const json = await res.json();
    if (json.ok === false) {
        throw new Error(`toncenter error: ${json.error ?? 'unknown'}`);
    }
    const result = json.result;
    if (!result) {
        throw new Error('toncenter response had no result field');
    }

    const balanceNano = BigInt(result.balance ?? '0');

    if (!result.data) {
        throw new Error('contract has no data yet (not deployed, or state not synced)');
    }

    const dataCell = Cell.fromBoc(Buffer.from(result.data, 'base64'))[0];
    const ds = dataCell.beginParse();
    const ownerAddress = ds.loadAddress();
    const pubkey = ds.loadUintBig(256);
    const flag = ds.loadInt(1) !== 0;
    const hasConfigDict = ds.loadMaybeRef() !== null;

    return {
        balanceNano,
        ownerAddress,
        pubkeyHex: pubkey.toString(16).padStart(64, '0'),
        flag,
        hasConfigDict,
    };
}
