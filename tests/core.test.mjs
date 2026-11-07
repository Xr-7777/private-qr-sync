import assert from "node:assert/strict";
import test from "node:test";
import QRCode from "qrcode";
import { decryptJson, encryptJson, randomSecret } from "../src/shared/encoding.ts";
import { inviteFromParams, inviteToUri } from "../src/shared/invite.ts";
import { conflictPath, isSyncablePath, validateSyncPath } from "../src/shared/paths.ts";
import { planSync } from "../src/shared/sync-plan.ts";

test("AES-GCM round trip rejects a different secret", async () => {
  const secret = randomSecret();
  const envelope = await encryptJson(secret, { note: "private" });
  assert.deepEqual(await decryptJson(secret, envelope), { note: "private" });
  await assert.rejects(() => decryptJson(randomSecret(), envelope));
});

test("pairing URI stays camera-friendly, round trips, and enforces expiry", () => {
  const invite = {
    version: 1,
    baseUrl: "http://192.168.1.2:27123",
    pairingId: "a".repeat(24),
    pairingSecret: randomSecret(),
    desktopName: "Home PC",
    vaultId: "Notes",
    expiresAt: Date.now() + 60_000,
  };
  const uriText = inviteToUri(invite);
  const uri = new URL(uriText);
  const params = Object.fromEntries(uri.searchParams);
  const decoded = inviteFromParams(params);
  assert.equal(decoded.baseUrl, invite.baseUrl);
  assert.equal(decoded.pairingId, invite.pairingId);
  assert.equal(decoded.pairingSecret, invite.pairingSecret);
  assert.equal(decoded.vaultId, invite.vaultId);
  assert.ok(uriText.length < 200);
  assert.ok(QRCode.create(uriText, { errorCorrectionLevel: "M" }).modules.size <= 61);
  assert.throws(() => inviteFromParams({ ...params, s: `${params.s}x` }));
});

test("vault paths cannot escape or expose Obsidian configuration", () => {
  assert.equal(validateSyncPath("notes/today.md"), "notes/today.md");
  assert.equal(isSyncablePath("notes/today.md"), true);
  assert.equal(isSyncablePath(".obsidian/plugins/a/data.json"), false);
  assert.equal(isSyncablePath("../secret.txt"), false);
  assert.equal(isSyncablePath("C:/secret.txt"), false);
  assert.match(conflictPath("notes/today.md", "My iPhone", 1), /^\.private-qr-sync-conflicts\/1-My-iPhone\//u);
});

test("sync plan transfers missing files and preserves both sides on differences", () => {
  const local = [
    { path: "local.md", size: 1, mtime: 1, hash: "l" },
    { path: "changed.md", size: 1, mtime: 20, hash: "new-local" },
  ];
  const remote = [
    { path: "remote.md", size: 1, mtime: 1, hash: "r" },
    { path: "changed.md", size: 1, mtime: 10, hash: "old-remote" },
  ];
  assert.deepEqual(planSync(local, remote), [
    { kind: "upload", path: "changed.md", preserveExisting: true },
    { kind: "upload", path: "local.md", preserveExisting: false },
    { kind: "download", path: "remote.md", preserveExisting: false },
  ]);
});

test("sync plan sends the newer copy in either direction", () => {
  const phoneNewer = planSync(
    [{ path: "note.md", size: 2, mtime: 20, hash: "phone" }],
    [{ path: "note.md", size: 1, mtime: 10, hash: "computer" }],
  );
  const computerNewer = planSync(
    [{ path: "note.md", size: 1, mtime: 10, hash: "phone" }],
    [{ path: "note.md", size: 2, mtime: 20, hash: "computer" }],
  );
  assert.deepEqual(phoneNewer, [{ kind: "upload", path: "note.md", preserveExisting: true }]);
  assert.deepEqual(computerNewer, [{ kind: "download", path: "note.md", preserveExisting: true }]);
});

