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

class Plugin {
  constructor() {
    this.app = {
      secretStorage: {
        getSecret: (name) => secrets.get(name) ?? null,
        setSecret: (name, value) => secrets.set(name, value),
      },
      vault: {
        getName: () => "Mobile Test",
        getFiles: () => [],
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
  TFile: class TFile {},
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
assert.deepEqual(vaultEvents, ["create", "modify"], "mobile load should watch local file changes");
assert.deepEqual([...new Set(calls)], ["obsidian"], "mobile load must not resolve Node modules");
console.log("Mobile bundle loaded without Node modules.");

const peerId = "a".repeat(24);
const secretName = "private-qr-sync-peer-test";
const peerSecret = "A".repeat(43);
secrets.set(secretName, peerSecret);
loadDataValue = {
  port: 0,
  deviceName: "Desktop test",
  pairedPeers: [{ id: peerId, name: "Mobile test", secretName, createdAt: Date.now() }],
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
await desktopPlugin.onunload();
console.log("Desktop bundle served health and encrypted revision endpoints.");

