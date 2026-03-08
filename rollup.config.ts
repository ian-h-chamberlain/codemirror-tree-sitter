import typescript from "@rollup/plugin-typescript";
import { RollupWasmOptions, wasm } from "@rollup/plugin-wasm";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import { defineConfig, Plugin, TransformHook, TransformResult } from "rollup";
import copy from "rollup-plugin-copy";
import { glob } from "node:fs";

export default () =>
  defineConfig([
    {
      input: ["src/index.ts"],
      watch: {
        include: ["src/*.ts"],
      },
      output: {
        dir: "dist",
        format: "es",
        globals: {
          "web-tree-sitter/web-tree-sitter.wasm": "treeSitterWasm",
          "@lumis-sh/wasm-nushell/tree-sitter-nushell.wasm": "nushellWasm",
        },
        sourcemap: process.env.BUILD !== "production",
      },
      plugins: [
        typescript(),
        nodeResolve({
          browser: true,
          extensions: [".mjs", ".js", ".json", ".node", ".wasm"],
        }),
        // tbd if this is still needed?
        rawWasm({ targetEnv: "browser", publicPath: "dist/" }),
      ],
    },
    {
      input: ["demo/index.ts"],
      output: {
        dir: "public",
        format: "iife",
        sourcemap: process.env.BUILD !== "production",
      },
      plugins: [
        typescript(),
        nodeResolve({
          browser: true,
          extensions: [".mjs", ".js", ".json", ".node", ".wasm"],
        }),
        rawWasm({ targetEnv: "browser" }),
        process.env.BUILD === "production" && terser(),
        {
          buildStart() {
            const extraWatchFiles = ["demo/index.html", "dist/*.js"];
            for (const pattern of extraWatchFiles) {
              glob(pattern, (_, paths) => paths.forEach(this.addWatchFile));
            }
            extraWatchFiles.forEach(this.addWatchFile);
          },
        },
        copy({
          targets: [
            {
              src: "demo/index.html",
              dest: "public",
            },
          ],
        }),
      ],
    },
  ]);

function rawWasm(options?: RollupWasmOptions): Plugin {
  // This cast might become invalid if the plugin ever changes
  const wasmPlugin = wasm(options) as { transform: TransformHook };
  if (!wasmPlugin.transform) {
    throw new Error("no transform registered on wasm plugin");
  }

  return {
    name: "rawWasm",
    ...wasmPlugin,
    transform(code, id): TransformResult {
      const result = wasmPlugin.transform.bind(this)(code, id);

      // hacky but meh
      if (typeof result !== "object" || !result?.code) return;
      const lines = result.code.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("import { _loadWasmModule }")) {
          lines[i] = `function _loadWasmModule(sync, filepath, src, imports) {
                return { sync, filepath, src, imports };
              }`;
        }
      }
      result.code = lines.join("\n");
      return result;
    },
  };
}
