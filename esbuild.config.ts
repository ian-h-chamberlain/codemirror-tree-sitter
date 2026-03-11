#!/usr/bin/env node

import * as esbuild from "esbuild";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { config } from "node:process";
import { setTimeout } from "node:timers/promises";

const { promise: shutdownSignal, resolve: shutdown } = Promise.withResolvers<{
  restart: boolean;
}>();

async function main() {
  switch (process.argv[2]) {
    case "serve":
      try {
        await buildAll({ serve: true });
      } catch (err) {
        // server sometimes needs a little time to release the port
        console.warn(err);
        await setTimeout(500);
        await buildAll({ serve: true });
      }
      break;

    case "watch":
      buildAll({ watch: true });
      break;

    default:
      buildAll({});
  }
}

const isProduction = process.env.BUILD === "production";
const commonOpts: Partial<esbuild.BuildOptions> = {
  bundle: true,
  platform: "browser",
  sourcemap: !isProduction,
  minify: isProduction,
  target: "es2020",
  // note for future ref: https://esbuild.github.io/plugins/#webassembly-plugin
  loader: { ".wasm": "file" },
  external: ["fs/promises", "module"],
};

async function buildLib() {
  await esbuild.build({
    entryPoints: ["src/index.ts"],
    outdir: "dist",
    bundle: true,
    format: "cjs",
    plugins: [watchConfig({ reload: false })],
    ...commonOpts,
  });
}

async function buildAll({ serve = false, watch = false }) {
  await buildLib();

  const ctx = await esbuild.context({
    entryPoints: ["demo/index.ts"],
    outdir: "public",
    format: "iife",
    plugins: [copyHtml, watchConfig({ reload: true })],
    ...commonOpts,
  });

  if (!serve && !watch) {
    await ctx.rebuild();
    await ctx.dispose();
    return;
  }

  if (serve) {
    const { hosts, port } = await ctx.serve({
      servedir: "public",
      port: 8000,
      onRequest: (req) => {
        console.log(`${req.path} ${req.status}`);
      },
    });

    //
    console.log(`Serving on:`);
    for (const host of hosts) {
      console.log(`- http://${host}:${port}`);
    }
  }

  await ctx.watch();
  const { restart } = await shutdownSignal;
  if (restart && process.execve) {
    process.execve(process.execPath, process.argv, process.env);
  } else {
    await ctx.dispose();
  }
}

const copyHtml: esbuild.Plugin = {
  name: "watch-html",
  setup: (build) => {
    const trigger = { filter: /[.]html$/, namespace: "file" };
    const dstDir = build.initialOptions.outdir || "";
    let loadCount = 0;

    let paths: [string, string][] = [];
    build.onStart(() => {
      paths.splice(0, paths.length);
    });
    build.onResolve(trigger, (args): esbuild.OnResolveResult => {
      const src = path.join(args.resolveDir, args.path);
      const dst = path.join(dstDir, args.path);
      paths.push([src, dst]);
      return { path: src, sideEffects: true, watchFiles: [src] };
    });
    build.onLoad(trigger, async (args): Promise<esbuild.OnLoadResult> => {
      // This feels like it shouldn't be necessary, but seems to be...
      const mtime = (await fs.stat(args.path)).mtimeMs;
      return {
        contents: `// mtime ${mtime}`,
        watchFiles: [args.path],
      };
    });
    build.onEnd(async () => {
      await Promise.all(
        paths.map(([src, dst]) => {
          console.log(
            "Copying",
            path.relative(".", src),
            "->",
            path.relative(".", dst),
          );
          return fs.copyFile(src, dst);
        }),
      );
    });
  },
};

const watchConfig = ({ reload }: { reload: boolean }): esbuild.Plugin => ({
  name: "watch-esbuild-config",
  setup: async (build) => {
    const namespace = "esbuild-config";
    const configPath = path.resolve("./esbuild.config.ts");

    let mtime = (await fs.stat(configPath)).mtimeMs;
    console.log({ reload, mtime });

    if (reload) {
      build.onStart(async () => {
        const stat = await fs.stat(configPath);
        if (mtime !== stat.mtimeMs && process.execve && reload) {
          console.log(`Config changed, restarting esbuild: (${mtime})`);
          shutdown({ restart: true });
        }
      });
    }
    build.onResolve({ filter: /esbuild[.]config$/ }, async ({ path }) => {
      return { path, namespace, sideEffects: true };
    });
    build.onLoad({ filter: /.*/, namespace }, async (args) => {
      return { contents: "", watchFiles: [configPath] };
    });
  },
});

main();
