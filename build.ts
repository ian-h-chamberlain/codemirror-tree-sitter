#!/usr/bin/env bun

import { BuildConfig, BunPlugin, Glob, OnResolveResult, $ } from "bun";
import { parseArgs } from "util";
import fs from "node:fs/promises";

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
  };

  const entrypoints: BuildConfig[] = [
    {
      // library
      entrypoints: ["./src"],
      outdir: "dist",
      root: "src",
      naming: "[name].[ext]",
      env: "NODE_*",
      sourcemap: true,
      ...config,
    },
    {
      // demo
      entrypoints: ["./demo/index.html"],
      outdir: "./public",
      minify: IS_PRODUCTION,
      sourcemap: !IS_PRODUCTION,
      ...config,
    },
  ];

  for (const cfg of entrypoints) {
    let out = await Bun.build(cfg);
    if (out.success) {
      console.log(
        `Built ${cfg.entrypoints[0]} -> ${cfg.outdir}: ${out.outputs.length} outputs`,
      );
    } else {
      console.log(`Failed to build ${cfg.entrypoints[0]}`);
      throw new Error(JSON.stringify(out));
    }
  }
}

async function clean() {
  const tarballs = Array.fromAsync(new Glob("*.{tgz,tar.gz}").scan());
  await Promise.all([
    fs.rm("./dist", { recursive: true, force: true }),
    fs.rm("./public", { recursive: true, force: true }),
    tarballs.then((paths) => paths.map(async (p) => await fs.rm)),
  ]);
  console.log("Cleaned up outputs");
}

// A simple plugin for use with the devserver, workaround for the lack of 'external'
// in the serve API
const ExternalModulePlugin: BunPlugin = {
  name: "external-module",
  setup(build) {
    build.onResolve(
      { filter: /^module$/ },
      async ({ path }): Promise<OnResolveResult> => ({ path, external: true }),
    );
  },
};

await main();

export default ExternalModulePlugin;
