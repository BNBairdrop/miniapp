# ResearchRelay Admin (testnet-only)

A small personal control panel for the `ResearchRelay` / `reconstructed_drainer_relay.fc`
security-research contract. It connects **your own** TonConnect wallet and lets
you fire each opcode manually, for continued behavioral study of the
reconstructed drainer logic. It is **not** meant to be opened by anyone else,
and it is **not** meant to be pointed at a mainnet deployment.

## Why this exists

The original research reconstructed a real-world drainer contract from
decompiled bytecode (see `reconstructed_drainer_relay.fc`'s header comment).
This panel is the remaining piece needed to keep exercising it on testnet by
hand — connect wallet → pick an opcode → fill in the fields → sign in your
wallet app — without round-tripping through raw `@ton/sandbox` test code for
every manual experiment.

## Setup

```bash
npm install
```

### 1. Host the TonConnect manifest somewhere HTTPS-reachable

TonConnect wallets fetch `tonconnect-manifest.json` from a public HTTPS URL
before they'll connect — `localhost` alone won't work for most wallet apps
(desktop extension wallets are sometimes the exception). Options, easiest
first:

- `npx ngrok http 5173` (or any tunnel) while running `npm run dev`, then put
  that `https://...ngrok...` URL into `public/tonconnect-manifest.json`'s
  `"url"` field (and an `iconUrl` — any small public PNG works for testnet).
- Deploy the built `dist/` folder to GitHub Pages / Vercel / Netlify and use
  that URL instead.

Edit `public/tonconnect-manifest.json` accordingly before connecting.

### 2. Run it

```bash
npm run dev
```

Open the printed local URL (through your tunnel if you're using one),
connect your **testnet** wallet, and paste the deployed `ResearchRelay`
testnet address into the "Contract address" field at the top.

## Signing the gated opcodes (`0xabcdef13`, `0x7362d09c`)

Both opcodes check an ed25519 signature over
`cell_hash(beginCell().storeAddress(sender_address).endCell())` — i.e. a
signature over the hash of **whichever address sends the message** (your
connected wallet), made with the secret key matching the contract's stored
`publicKey`. The panel never asks for that secret key — it stays out of the
browser entirely. Instead:

1. Connect your wallet in the panel; the log prints `hash to sign offline
   for sender ...` the moment you touch either gated op's button.
2. Run the offline signer with the secret key you got from
   `deployResearchRelay.ts`'s console output when you deployed:
   ```bash
   npm run sign -- <secretKeyHex> <yourWalletAddress>
   ```
3. Paste the printed `signature hex` into the matching field in the panel.

To deliberately exercise the **unauthorized** path of `0x7362d09c` (the
`config_dict`-gated redirect / owner fallback), just leave its signature
field blank — the panel sends 64 zero bytes, which `check_signature` will
reject, forcing the fallback branch.

## Running it as a Telegram Mini App

1. **Host it over HTTPS** (same requirement as the TonConnect manifest above —
   `ngrok http 5173` during dev, or deploy `dist/` to GitHub Pages/Vercel/Netlify
   for something longer-lived). Telegram, like TonConnect, will not load a
   plain `http://localhost` URL as a Mini App.

2. **Create/configure a bot with [@BotFather](https://t.me/BotFather)**:
   - `/newbot` if you don't have one yet.
   - `/mybots` → your bot → *Bot Settings* → *Menu Button* → *Configure Menu
     Button* → paste your hosted HTTPS URL. This makes the Mini App open from
     the chat's menu button.
   - Alternatively `/newapp` to register it as a full Mini App with its own
     deep link.

3. **Restrict it to yourself**: open `src/telegram.ts` and put your numeric
   Telegram user id in `ALLOWED_TELEGRAM_USER_IDS` (get it once by opening the
   Mini App with the array empty, triggering any action, and reading the id
   TonConnect/Telegram logs in the browser console — or just ask
   [@userinfobot](https://t.me/userinfobot)). Rebuild/redeploy after setting
   it. Leaving the array empty disables the check (useful for local testing
   outside Telegram, where `initDataUnsafe.user` isn't populated anyway).

   This is a **client-side tripwire**, not a real security boundary — it
   reads `Telegram.WebApp.initDataUnsafe`, which is literally named "unsafe"
   because nothing stops a motivated person from editing it before your JS
   runs. For a boundary that actually holds, `initData` (the signed string,
   not `initDataUnsafe`) needs HMAC verification against your bot token on a
   backend. Out of scope for a single-user testnet tool, but worth knowing if
   this ever stops being "just me."

4. Open the bot in Telegram, tap the menu button, connect your testnet wallet
   via the TonConnect button inside the Mini App exactly as before.

The panel also refuses to **send** anything if the connected wallet reports a
non-testnet chain id (`CHAIN.TESTNET = "-3"` per `@tonconnect/sdk`) — this is
checked in `main.ts`'s `requireTestnet()` before every `sendTransaction` call.

## Files

- `src/relayOps.ts` — op body builders (ported from `wrappers/ResearchRelay.ts`,
  stripped of the Blueprint `ContractProvider` dependency since TonConnect
  only needs a destination address + base64 BoC body).
- `src/telegram.ts` — Telegram WebApp bridge init, theme sync, user allow-list gate.
- `src/state.ts` — reads the contract's raw storage cell via TON Center's
  testnet REST API and parses it per `load_data()` in the `.fc` source
  (no get-method exists for this contract's own state, so this parses the
  account's raw `data` BoC directly rather than guessing a getter).
- `src/main.ts` — wires the HTML form in `index.html` to TonConnect + Telegram.
- `scripts/sign-offline.ts` — offline signer, keeps the secret key out of the browser.

## Caveats / things I could not verify here

This was written in a container with no TON toolchain installed, so none of
`npm install`, `npm run dev`, or `npm run sign` were actually executed.
Please run it yourself and send me any error output — in particular:

- Confirm `@tonconnect/ui`'s `sendTransaction` payload shape still matches
  (`messages[].address` as user-friendly base64url, `.amount` as a nanoton
  decimal string, `.payload` as base64 BoC) — I checked this against the
  package's own `.d.ts` rather than guessing, but APIs do change.
- The `buffer` polyfill (`globalThis.Buffer = Buffer`) is the standard fix
  for `@ton/core` in a Vite browser build; if Vite complains about other
  Node built-ins, `vite-plugin-node-polyfills` is the usual next step.
- `src/state.ts` hits TON Center's public testnet REST API
  (`getAddressInformation`) and parses the response's `data`/`balance`
  fields. I confirmed the endpoint, query params, and `TonlibResponse`
  envelope shape against the published `openapi.json`, but couldn't fetch
  the full `AddressInformationRequest`/response schema (the doc page was
  truncated) or call it live from this container (outbound HTTPS here is
  allowlisted and `toncenter.com` isn't on it). If `result.data` turns out
  to be named or shaped differently than expected, the state panel will
  throw a clear error rather than silently show wrong numbers — check that
  first if "Refresh state" fails.
- Not yet implemented (left for a follow-up pass, per "develop further if
  needed"): deploying/calling the mock jetton wallet to exercise
  `transfer_notification` end-to-end instead of hand-building it, and a
  `get_nft_data()` viewer via `runGetMethod` (skipped because I couldn't
  verify TON Center's exact TVM-stack response format for that endpoint from
  here, and didn't want to guess at a format you'd silently misread).
