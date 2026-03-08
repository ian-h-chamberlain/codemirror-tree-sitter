import typescript from "@rollup/plugin-typescript";
import { RollupWasmOptions, wasm } from "@rollup/plugin-wasm";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import { defineConfig, Plugin, TransformHook, TransformResult } from "rollup";
import serve from "rollup-plugin-serve";

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

export default () =>
  defineConfig([
    {
      input: ["src/index.ts", "demo/index.ts"],
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
        rawWasm({ targetEnv: "browser", publicPath: "dist/" }),
      ],
    },
    {
      input: ["demo/index.ts"],
      output: {
        dir: "./demo/dist",
        format: "iife",
        sourcemap: true,
      },
      plugins: [
        typescript(),
        nodeResolve({
          browser: true,
          extensions: [".mjs", ".js", ".json", ".node", ".wasm"],
        }),
        rawWasm({ targetEnv: "browser", publicPath: "demo/dist/" }),
      ],
    },
  ]);
