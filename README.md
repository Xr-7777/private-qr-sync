# Private QR Sync

Private QR Sync connects an Obsidian desktop vault directly to an iPhone or iPad on the same trusted LAN. The desktop displays a short-lived QR invitation; the iOS Camera opens Obsidian, the plugin exchanges a one-time bootstrap secret, and later transfers use a per-device AES-256-GCM key.

No note, attachment, account, signalling request, or telemetry is sent to a cloud service. GitHub is used only to distribute the plugin during beta installation.

## Current MVP

- Desktop is the LAN host; mobile is a client because iOS cannot open a Node HTTP server.
- QR pairing uses `obsidian://private-qr-sync` and expires after ten minutes.
- The bootstrap invitation is single-use. Every paired mobile device receives a separate revocable key.
- Secrets use Obsidian SecretStorage and are not written to plugin `data.json`.
- Requests and file bodies are encrypted with AES-256-GCM, even though the LAN endpoint uses HTTP.
- Notes and attachments sync incrementally by SHA-256 hash.
- While mobile Obsidian is open, phone edits trigger a silent sync and computer edits are checked every minute.
- Repeated checks reuse hashes for unchanged files instead of rereading the entire vault.
- Before overwriting a changed file, the losing version is copied to `.private-qr-sync-conflicts/`.
- `.obsidian`, `.trash`, and conflict backups are excluded.
- Files over 20 MB are skipped by default.

`shortcut: deletions are not propagated in the MVP; add authenticated tombstones and a recovery UI before enabling deletes.`

The iPhone must have Obsidian open for sync. iOS suspends community plugins in the background.

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

