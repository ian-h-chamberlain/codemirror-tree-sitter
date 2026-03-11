#!/usr/bin/env node

import * as esbuild from "esbuild";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const isProduction = process.env.BUILD === "production";

async function buildLib() {
  await esbuild.build({
    entryPoints: ["src/index.ts"],
    outdir: "dist",
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: "es2020",
    sourcemap: !isProduction,
    minify: isProduction,
    metafile: true,
    external: ["fs/promises", "module"],
    // note for future ref: https://esbuild.github.io/plugins/#webassembly-plugin
    loader: { ".wasm": "file" },
  });
}

async function demo({ build = false, serve = false, watch = false }) {
  await buildLib();

  const ctx = await esbuild.context({
    entryPoints: ["demo/index.ts"],
    outdir: "public",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    sourcemap: !isProduction,
    minify: isProduction,
    external: ["fs/promises", "module"],
    loader: { ".wasm": "file" },
    plugins: [watchHtml()],
  });

  if (build) {
    ctx.rebuild();
  }

  if (serve) {
    const { hosts, port } = await ctx.serve({ servedir: "public" });

    console.log(`Serving on:`);
    for (const host of hosts) {
      console.log(`- http://${host}:${port}`);
    }
  }

  if (watch || serve) {
    await ctx.watch();
  } else {
    await ctx.dispose();
  }
}

function watchHtml(): esbuild.Plugin {
  return {
    name: "watch-html",
    setup: (build) => {
      let paths: string[] = [];

      build.onStart(() => {
        paths = [];
      });

      const trigger = { filter: /\.html$/, namespace: "file" };

      build.onResolve(trigger, (args) => {
        const src = path.join(args.resolveDir, args.path);
        paths.push(src);
        return { path: src, watchFiles: [src], sideEffects: true };
      });

      build.onLoad(trigger, async (args) => {
        // Force content to change, triggering a reload
        const stat = await fs.stat(args.path);
        return { contents: `// mtime = ${stat.mtime}` };
      });

      build.onEnd(async () => {
        const destDir = build.initialOptions.outdir || "";
        await Promise.all(
          paths.map((src) => {
            const dest = path.join(destDir, path.basename(src));
            fs.copyFile(src, dest);
          }),
        );
      });
    },
  };
}

switch (process.argv[2]) {
  case "serve":
    demo({ serve: true });
  case "watch":
    demo({ watch: true });
  default:
    demo({ build: true });
}
