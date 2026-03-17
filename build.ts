#!/usr/bin/env bun

import { BuildConfig, BunPlugin, Glob, OnResolveResult, $ } from "bun";
import fs from "fs/promises";
import path from "path";

async function main() {
  // [bun, build.ts, _ ]
  const args = Bun.argv.slice(2);
  if (args.length > 1) {
    throw Error("max one subcommand is supported");
  }

  switch (args[0]) {
    case "clean":
      return await clean();

    case "build":
    default:
      return await build();
  }
}

async function build() {
  const IS_PRODUCTION = process.env.NODE_ENV === "production";

  await $`tsc --build`;

  const config: Partial<BuildConfig> = {
    external: ["module"],
    target: "browser",
    format: "esm",
    splitting: false,
  };

  const lib: Partial<BuildConfig> = {
    ...config,
    naming: "[name].[ext]",
    env: "NODE_*",
    sourcemap: true,
  };

  const entrypoints: BuildConfig[] = [
    {
      ...lib,
      entrypoints: ["./packages/adapter/src/index.ts"],
      outdir: "./packages/adapter/dist",
      root: "./packages/adapter/src",
      packages: "external",
    },
    {
      // nushell
      ...lib,
      entrypoints: ["./packages/nushell/src/index.ts"],
      outdir: "./packages/nushell/dist",
      root: "./packages/nushell/src",
      packages: "external",
    },
    {
      // demo
      ...config,
      entrypoints: ["./packages/demo/index.html"],
      outdir: "./packages/demo/public",
      minify: IS_PRODUCTION,
      sourcemap: !IS_PRODUCTION,
      plugins: [CodeMirrorPlugin],
    },
  ];

  for (const cfg of entrypoints) {
    console.log(`Building '${cfg.entrypoints[0]}'...`);
    const out = await Bun.build(cfg);
    console.log(`Built -> '${cfg.outdir}': ${out.outputs.length} outputs`);
  }
}

async function clean() {
  const tarballs = Array.fromAsync(
    new Glob("packages/*/*.{tgz,tar.gz}").scan(),
  );
  const dirs = Array.fromAsync(
    new Glob("packages/*/{dist,public}").scan({ onlyFiles: false }),
  );
  await Promise.all([
    dirs.then((paths) =>
      paths.map(async (p) => await fs.rm(p, { recursive: true, force: true })),
    ),
    tarballs.then((paths) =>
      paths.map(async (p) => await fs.rm(p, { force: true })),
    ),
  ]);
  console.log("Cleaned up outputs");
}

// Seems to be enough to work around some issues like:
// - https://github.com/uiwjs/react-codemirror/issues/707#issuecomment-2630203529
// - https://github.com/oven-sh/bun/issues/26901
const CodeMirrorPlugin: BunPlugin = {
  name: "codemirror-cjs",
  setup: (build) => {
    // this is hacky af, should use module.paths or something probably
    const modulesDir = path.resolve(__dirname, "node_modules");

    build.onResolve({ filter: /^@?codemirror/ }, async (args) => {
      const pkgdir = path.resolve(modulesDir, args.path);
      const packageJson = JSON.parse(
        await fs.readFile(path.resolve(pkgdir, "package.json"), {
          encoding: "utf-8",
        }),
      );
      const modpath = path.resolve(
        pkgdir,
        packageJson.exports?.require ||
          packageJson.main ||
          packageJson.exports?.import ||
          packageJson.module,
      );
      return { path: modpath };
    });
  },
};

// A simple plugin for use with the devserver, workaround for the lack of 'external'
// in the serve API
const ServerPlugin: BunPlugin = {
  name: "static-server",
  setup(build) {
    // workaround for lack of multi-plugin handling
    CodeMirrorPlugin.setup(build);
    build.onResolve(
      { filter: /^module$/ },
      async ({ path }): Promise<OnResolveResult> => ({ path, external: true }),
    );
  },
};

await main();

export default ServerPlugin;
