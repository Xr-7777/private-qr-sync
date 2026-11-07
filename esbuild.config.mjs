import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";

const watch = process.argv.includes("--watch");
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
  ],
  format: "cjs",
  target: "es2022",
  platform: "browser",
  outfile: "main.js",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  treeShaking: true,
  logLevel: "info",
});

if (watch) {
  await context.watch();
  console.log("[private-qr-sync] watching");
} else {
  await context.rebuild();
  await context.dispose();
  console.log("[private-qr-sync] built main.js");
}

