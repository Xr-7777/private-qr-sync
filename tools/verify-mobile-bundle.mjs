import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as http from "node:http";

const code = await readFile(new URL("../main.js", import.meta.url), "utf8");
const calls = [];
let protocolHandler;
let loadDataValue = null;
let capturedServer;

class Plugin {
  constructor() {
    this.app = {
      secretStorage: { getSecret: () => null, setSecret: () => {} },
      vault: { getName: () => "Mobile Test", getFiles: () => [] },
    };
  }
  async loadData() { return loadDataValue; }
  async saveData() {}
  addSettingTab() {}
  addRibbonIcon() {}
  addCommand() {}
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
  throw new Error(`Mobile bundle unexpectedly required ${id}`);
};

new Function("require", "module", "exports", code)(localRequire, module, module.exports);
const PluginClass = module.exports.default ?? module.exports;
assert.equal(typeof PluginClass, "function", "bundle should export the plugin class");
const plugin = new PluginClass();
await plugin.onload();
assert.equal(typeof protocolHandler, "function", "mobile protocol handler should be registered");
assert.deepEqual([...new Set(calls)], ["obsidian"], "mobile load must not resolve Node modules");
console.log("Mobile bundle loaded without Node modules.");

loadDataValue = { port: 0, deviceName: "Desktop test" };
obsidian.Platform.isDesktopApp = true;
obsidian.Platform.isMobile = false;
obsidian.Platform.isIosApp = false;
const desktopPlugin = new PluginClass();
await desktopPlugin.onload();
const address = capturedServer?.address();
assert.equal(typeof address, "object", "desktop server should listen on a real port");
const health = await fetch(`http://127.0.0.1:${address.port}/health`);
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { ok: true, service: "private-qr-sync", version: 1 });
await desktopPlugin.onunload();
console.log("Desktop bundle served the health endpoint.");

