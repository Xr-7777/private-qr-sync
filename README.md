# Private QR Sync

Private QR Sync connects Obsidian vaults directly across Windows, macOS, iPhone, and iPad on the same trusted LAN. One computer acts as the host; another desktop pastes its short-lived pairing link, while iOS can scan the QR code. Later transfers use a per-device AES-256-GCM key.

No note, attachment, account, signalling request, or telemetry is sent to a cloud service. GitHub is used only to distribute the plugin during beta installation.

## Current MVP

- One Windows or macOS computer is the LAN host; macOS, Windows, iPhone, or iPad can be a client.
- QR pairing uses `obsidian://private-qr-sync` and expires after ten minutes.
- Mobile accepts only private IPv4 pairing addresses and requires confirmation before the first sync.
- The bootstrap invitation is single-use. Every paired client receives a separate revocable key.
- Secrets use Obsidian SecretStorage and are not written to plugin `data.json`.
- Requests and file bodies are encrypted with AES-256-GCM, even though the LAN endpoint uses HTTP.
- Encrypted responses are bound to the exact request nonce and endpoint to reject replayed or swapped responses.
- Notes and attachments sync incrementally by SHA-256 hash.
- Every paired device has its own enable switch, direction, selected paths, deletion policy, and transfer permission.
- Sync direction can be host ↔ device, host → device, or device → host. One-way sync always treats the selected source as authoritative.
- Empty selected paths mean the whole vault; otherwise only exact notes and folders ending in `/` participate.
- One-time transfer is separate from sync: it never deletes, and same-name different content is saved as a second file.
- While client Obsidian is open, local edits trigger a silent sync and host edits are detected within about two seconds.
- The client poll transfers only an encrypted revision token; a full vault comparison runs only after a change.
- Repeated checks reuse hashes for unchanged files instead of rereading the entire vault.
- Before overwriting a changed file, the losing version is copied to `.private-qr-sync-conflicts/`.
- Deletions are off by default. If enabled, they follow the selected sync direction; before removing the target copy, the plugin saves it under `.private-qr-sync-conflicts/`.
- Conflict and deletion backups use Obsidian's cross-platform storage adapter so hidden recovery folders work on macOS and iOS.
- `.obsidian`, `.trash`, and conflict backups are excluded.
- Obsidian plugins and settings are intentionally not copied; install Private QR Sync separately on every device.
- Files over 20 MB are skipped by default.

The iPhone must have Obsidian open for sync. iOS suspends community plugins in the background.

## Transfer versus sync

- **One-time transfer**: on the client, enter exact note paths or folders ending in `/`, then choose **Host → this device** or **This device → host**. It never deletes or replaces different content; a same-name difference becomes a visible second file.
- **Ongoing sync**: on the host, configure each paired device independently. Choose its direction and selected paths, then enable automatic sync on the client. A one-way source replaces only matching selected target paths; target-only notes remain untouched, and replaced content is recoverable from `.private-qr-sync-conflicts/`.
- Keep **Synchronize deletions** off unless deletion propagation is intentional. Turning it on applies only to future deletions inside the selected paths.

## Pair Windows and macOS

1. Install and enable Private QR Sync in vaults with the same name on both computers.
2. On the computer that will stay awake as the host, open the plugin settings and choose **Show QR code** → **Copy pairing link**.
3. On the other computer, open the plugin settings, paste the link under **Use this computer as a client**, and choose **Pair and sync**.
4. Confirm the host address and vault name. The client will then sync automatically while Obsidian is open.

## Install on desktop for development

```bash
npm install
npm run check
```

Copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<vault>/.obsidian/plugins/private-qr-sync/
```

Enable **Private QR Sync** under Obsidian → Settings → Community plugins. Open its settings and choose **Show QR code**.

## Install on iPhone during beta

The plugin must be published to a GitHub repository with a release containing `main.js`, `manifest.json`, and `styles.css`. This project includes a release workflow that creates those assets when a version tag such as `0.1.0` is pushed.

1. On iPhone Obsidian, open Settings → Community plugins → Browse.
2. Create or open an empty mobile vault whose name exactly matches the desktop vault.
3. Install and enable **BRAT**.
4. Open BRAT settings → **Add Beta plugin**.
5. Paste `https://github.com/Xr-7777/private-qr-sync`.
6. Enable **Private QR Sync** in Community plugins.
7. Scan the QR code on the computer with the iPhone Camera and tap **Open in Obsidian**.

After publication in the Obsidian Community Plugins directory, BRAT is no longer required.

## Security boundary

- Use only on a private network you trust. The encrypted application payload protects file content, but IP addresses, timing, message sizes, and endpoint paths remain visible to the LAN.
- Do not expose the port directly to the internet.
- Allow Obsidian through the Windows firewall only on **Private networks** when Windows asks.
- A QR code is a credential until it expires. Do not photograph or share it.
- Revoking a device removes its key from the desktop allow-list and overwrites the local SecretStorage entry.
- There is no third-party relay, so the desktop must be awake and reachable.

## Prior art reviewed

- [LAN Vault Sync](https://github.com/senjanson/lan-vault-sync), MIT: desktop-host/mobile-client topology and Obsidian protocol QR pairing.
- [Vault Bridge](https://github.com/YaYII/obsidian-vault-bridge), MIT: one browser bundle with desktop-only Node modules loaded lazily, plus mobile distribution lessons.
- [Peer Share](https://github.com/gapmiss/peer-share), MIT: chunked mobile transfers and PairDrop interoperability.
- [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync): encrypted setup URIs and mature conflict-handling concepts.
- [Obsidian Decentralized](https://github.com/morewebs/obsidian-decentralized), GPL-3.0: WebRTC and application-layer encryption were studied; no source code was copied because this project uses the MIT license.

## Commands

```bash
npm run build
npm run typecheck
npm test
npm run check
```

## License

MIT

