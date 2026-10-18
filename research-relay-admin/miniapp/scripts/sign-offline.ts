// Run this with `npx tsx scripts/sign-offline.ts <secretKeyHex> <addressToSignFor>`
// (or `npm run sign -- <secretKeyHex> <addressToSignFor>`).
//
// Produces the ed25519 signature the ResearchRelay contract expects for
// op::0xabcdef13 and op::0x7362d09c: a signature over
// cell_hash(beginCell().storeAddress(addr).endCell()), using the secret key
// that matches the relay's stored publicKey.
//
// Kept as a separate, offline-only script on purpose — the secret key never
// touches the browser app in src/. Paste only the resulting signature hex
// into the admin panel's signature fields.

import { Address, beginCell } from '@ton/core';
import { sign, keyPairFromSecretKey } from '@ton/crypto';

function main() {
    const [secretKeyHex, addrStr] = process.argv.slice(2);
    if (!secretKeyHex || !addrStr) {
        console.error('usage: sign-offline.ts <secretKeyHex (64 bytes)> <address to sign for>');
        process.exit(1);
    }

    const secretKey = Buffer.from(secretKeyHex.replace(/^0x/i, ''), 'hex');
    if (secretKey.length !== 64) {
        console.error(`secret key must be 64 bytes (128 hex chars), got ${secretKey.length} bytes`);
        process.exit(1);
    }

    const keyPair = keyPairFromSecretKey(secretKey);
    const addr = Address.parse(addrStr);
    const hash = beginCell().storeAddress(addr).endCell().hash();
    const signature = sign(hash, keyPair.secretKey);

    console.log('address:       ', addr.toString({ urlSafe: true, bounceable: true, testOnly: true }));
    console.log('hash (hex):    ', hash.toString('hex'));
    console.log('public key:    ', keyPair.publicKey.toString('hex'));
    console.log('signature hex: ', signature.toString('hex'));
    console.log('\nPaste the signature hex above into the admin panel.');
}

main();
