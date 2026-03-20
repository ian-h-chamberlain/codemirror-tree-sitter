#!/usr/bin/env bun

import { BuildConfig, BunPlugin, Glob, OnResolveResult, $ } from "bun";
import fs from "fs/promises";
import path from "path";

async function main() {
  // ['bun', './build', ... ]
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

  const entrypoints: { [cwd: string]: BuildConfig } = {
    './packages/adapter': {
      ...lib,
      entrypoints: ["./src/index.ts"],
      outdir: "./dist",
      root: "./src",
      packages: "external",
    },
    './packages/nushell': {
      ...lib,
      entrypoints: ["./src/index.ts"],
      outdir: "./dist",
      root: "./src",
      packages: "external",
    },
    './packages/demo': {
      ...config,
      entrypoints: ["./index.html"],
      outdir: "./public",
      minify: IS_PRODUCTION,
      sourcemap: !IS_PRODUCTION,
    },
  };

  for (const [cwd, cfg] of Object.entries(entrypoints)) {
    console.log(`Building '${cfg.entrypoints[0]}'...`);
    const topDir = process.cwd();
    process.chdir(path.resolve(cwd));
    const out = await Bun.build(cfg);
    console.log(`Built -> '${cfg.outdir}': ${out.outputs.length} outputs`);
    process.chdir(topDir);
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

// A simple plugin for use with the devserver, workaround for the lack of 'external'
// in the serve API
const ServerPlugin: BunPlugin = {
  name: "static-server",
  setup(build) {
    build.onResolve(
      { filter: /^module$/ },
      async ({ path }): Promise<OnResolveResult> => ({ path, external: true }),
    );
  },
};

await main();

export default ServerPlugin;
