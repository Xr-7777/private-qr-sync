import assert from "node:assert/strict";
import * as buffer from "node:buffer";
import { readFile } from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";

const code = await readFile(new URL("../main.js", import.meta.url), "utf8");
const calls = [];
const vaultEvents = [];
let protocolHandler;
let loadDataValue = null;
let capturedServer;
const secrets = new Map();

class TFile {
  constructor(path, data = new ArrayBuffer(0), mtime = Date.now()) {
    this.path = path;
    this.data = data.slice(0);
    this.stat = { size: data.byteLength, mtime, ctime: mtime };
  }
}

class TFolder {
  constructor(path) { this.path = path; }
}

class Plugin {
  constructor() {
    const files = new Map();
    const folders = new Map();
    this.app = {
      secretStorage: {
        getSecret: (name) => secrets.get(name) ?? null,
        setSecret: (name, value) => secrets.set(name, value),
      },
      vault: {
        getName: () => "Mobile Test",
        getFiles: () => [...files.values()],
        getAbstractFileByPath: (path) => files.get(path) ?? folders.get(path) ?? null,
        readBinary: async (file) => file.data.slice(0),
        createBinary: async (path, data, options = {}) => {
          const file = new TFile(path, data, options.mtime ?? Date.now());
          files.set(path, file);
          return file;
        },
        modifyBinary: async (file, data, options = {}) => {
          file.data = data.slice(0);
          file.stat = { size: data.byteLength, mtime: options.mtime ?? Date.now(), ctime: file.stat.ctime };
        },
        delete: async (file) => { files.delete(file.path); },
        createFolder: async (path) => {
          const folder = new TFolder(path);
          folders.set(path, folder);
          return folder;
        },
        adapter: {
          exists: async (path) => files.has(path) || folders.has(path),
          mkdir: async (path) => { folders.set(path, new TFolder(path)); },
          writeBinary: async (path, data) => { files.set(path, new TFile(path, data)); },
        },
        on: (name) => {
          vaultEvents.push(name);
          return {};
        },
      },
    };
  }
  async loadData() { return loadDataValue; }
  async saveData() {}
  addSettingTab() {}
  addRibbonIcon() {}
  addCommand() {}
  register() {}
  registerEvent() {}
  registerInterval() {}
  registerObsidianProtocolHandler(_action, handler) { protocolHandler = handler; }
}

class Modal { constructor(app) { this.app = app; } }
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }
class Setting {}
class Notice { setMessage() {} hide() {} }

const obsidian = {
  Plugin,
  Modal,
  PluginSettingTab,
  Setting,
  Notice,
  Platform: { isDesktopApp: false, isMobile: true, isIosApp: true },
  requestUrl: async () => { throw new Error("not called during load"); },
  TFile,
};

const module = { exports: {} };
globalThis.window = {
  clearTimeout() {},
  setInterval: () => 1,
  setTimeout: () => 1,
};
const localRequire = (id) => {
  calls.push(id);
  if (id === "obsidian") return obsidian;
  if (id === "http") {
    return {
      ...http,
      createServer: (...args) => {
        capturedServer = http.createServer(...args);
        return capturedServer;
      },
    };
  }
  if (id === "os") return os;
  if (id === "buffer") return buffer;
  throw new Error(`Mobile bundle unexpectedly required ${id}`);
};

new Function("require", "module", "exports", code)(localRequire, module, module.exports);
const PluginClass = module.exports.default ?? module.exports;
assert.equal(typeof PluginClass, "function", "bundle should export the plugin class");
const plugin = new PluginClass();
await plugin.onload();
assert.equal(typeof protocolHandler, "function", "mobile protocol handler should be registered");
assert.deepEqual(vaultEvents, ["create", "modify", "delete", "rename"], "mobile load should watch local file changes and deletes");
assert.deepEqual([...new Set(calls)], ["obsidian"], "mobile load must not resolve Node modules");
console.log("Mobile bundle loaded without Node modules.");

const peerId = "a".repeat(24);
const secretName = "private-qr-sync-peer-test";
const peerSecret = "A".repeat(43);
const peerPolicy = {
  enabled: true,
  mode: "two-way",
  paths: [],
  syncDeletes: true,
  deleteEnabledAt: 0,
  allowTransfers: true,
};
secrets.set(secretName, peerSecret);
loadDataValue = {
  port: 0,
  deviceName: "Desktop test",
  pairedPeers: [{ id: peerId, name: "Mobile test", secretName, createdAt: Date.now(), policy: peerPolicy }],
};
obsidian.Platform.isDesktopApp = true;
obsidian.Platform.isMobile = false;
obsidian.Platform.isIosApp = false;
const desktopPlugin = new PluginClass();
await desktopPlugin.onload();
const address = capturedServer?.address();
assert.equal(typeof address, "object", "desktop server should listen on a real port");
assert.notEqual(address.address, "0.0.0.0", "desktop server should bind only to the selected LAN address");
const health = await fetch(`http://${address.address}:${address.port}/health`);
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { ok: true, service: "private-qr-sync", version: 2 });
const unauthorized = await fetch(`http://${address.address}:${address.port}/v1/revision`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Pair-Id": "unknown" },
  body: "{}",
});
assert.equal(unauthorized.status, 401, "unknown devices should be rejected before encrypted body processing");

obsidian.requestUrl = async (options) => {
  const response = await fetch(options.url, {
    method: options.method,
    headers: options.headers,
    body: options.body,
  });
  return { status: response.status, json: await response.json() };
};
const peer = {
  id: peerId,
  name: "Desktop test",
  baseUrl: `http://${address.address}:${address.port}`,
  secretName,
  vaultId: "Mobile Test",
};
const revisionBefore = await plugin.client.getRevision(peer);
desktopPlugin.server.markChanged();
const revisionAfter = await plugin.client.getRevision(peer);
assert.notEqual(revisionAfter, revisionBefore, "desktop changes should advance the encrypted revision token");
const emptySync = await plugin.client.sync(peer, "Mobile test", 20, []);
assert.deepEqual(emptySync, {
  report: { uploaded: 0, downloaded: 0, deleted: 0, conflictsPreserved: 0, skipped: 0, failures: [] },
  deletions: [],
  policy: peerPolicy,
}, "new clients should exchange an encrypted deletion journal");
await plugin.app.vault.createBinary("transfer.md", new TextEncoder().encode("client copy").buffer, { mtime: 1 });
await desktopPlugin.app.vault.createBinary("transfer.md", new TextEncoder().encode("host copy").buffer, { mtime: 2 });
const transfer = await plugin.client.transferFromHost(peer, "Mobile test", 20, ["transfer.md"]);
assert.equal(transfer.duplicates, 1, "one-time transfer must preserve same-name different content as a copy");
assert.equal(
  plugin.app.vault.getFiles().filter((file) => file.path.startsWith("transfer (from Desktop-test ")).length,
  1,
  "one-time transfer should create a named copy instead of overwriting",
);
desktopPlugin.settings.pairedPeers[0].policy.mode = "host-to-client";
desktopPlugin.settings.pairedPeers[0].policy.syncDeletes = false;
desktopPlugin.settings.pairedPeers[0].policy.paths = ["one-way.md"];
await plugin.app.vault.createBinary("one-way.md", new TextEncoder().encode("client original").buffer, { mtime: 30 });
await desktopPlugin.app.vault.createBinary("one-way.md", new TextEncoder().encode("host authoritative").buffer, { mtime: 10 });
const oneWaySync = await plugin.client.sync(peer, "Mobile test", 20, []);
const oneWayClientFile = plugin.app.vault.getAbstractFileByPath("one-way.md");
assert.equal(
  new TextDecoder().decode(oneWayClientFile.data),
  "host authoritative",
  "host-to-client sync must apply the selected host copy even when the client copy is newer",
);
assert.equal(oneWaySync.report.downloaded, 1);
assert.equal(oneWaySync.report.conflictsPreserved, 1, "the replaced client copy must be backed up");
assert.equal(
  plugin.app.vault.getFiles().filter((file) => file.path.startsWith(".private-qr-sync-conflicts/")).length,
  1,
  "the overwritten client original must remain in its local recovery folder",
);
desktopPlugin.settings.pairedPeers[0].policy.mode = "two-way";
desktopPlugin.settings.pairedPeers[0].policy.syncDeletes = true;
desktopPlugin.settings.pairedPeers[0].policy.paths = ["deleted.md"];
const deletion = { path: "deleted.md", deletedAt: Date.now(), deviceName: "Mobile test" };
await desktopPlugin.app.vault.createBinary("deleted.md", new TextEncoder().encode("recover me").buffer, { mtime: 1 });
const deletionSync = await plugin.client.sync(peer, "Mobile test", 20, [deletion]);
assert.equal(desktopPlugin.app.vault.getAbstractFileByPath("deleted.md"), null, "a client deletion should remove the host copy");
assert.equal(
  desktopPlugin.app.vault.getFiles().filter((file) => file.path.startsWith(".private-qr-sync-conflicts/")).length,
  1,
  "the host copy must be backed up before deletion",
);
assert.equal(deletionSync.report.deleted, 1);
assert.equal(deletionSync.report.conflictsPreserved, 1);
await desktopPlugin.onunload();
console.log("Desktop bundle served policy, transfer, one-way sync, revision, and deletion endpoints.");

capturedServer = undefined;
loadDataValue = {
  deviceName: "Mac client test",
  mobilePeer: peer,
};
const desktopClientPlugin = new PluginClass();
await desktopClientPlugin.onload();
assert.equal(capturedServer, undefined, "a paired desktop client must not start a second sync server");
await desktopClientPlugin.onunload();
console.log("Desktop client loaded without starting a host server.");

