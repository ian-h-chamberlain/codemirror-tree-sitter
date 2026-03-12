#!/usr/bin/env bun

import bun from "bun";
import { Glob, BuildConfig, BunPlugin, OnResolveResult } from "bun";
import fs from "node:fs/promises";

async function main() {
  const IS_PRODUCTION = process.env.NODE_ENV === "production";

  const config: Partial<BuildConfig> = {
    external: ["module"],
    minify: IS_PRODUCTION,
    sourcemap: !IS_PRODUCTION,
    target: "browser",
    splitting: false,
    naming: {},
  };

  const entrypoints: BuildConfig[] = [
    {
      // library
      entrypoints: ["./src"],
      outdir: "dist",
      root: "src",
      naming: "[name].[ext]",
      ...config,
    },
    {
      // demo
      entrypoints: ["./demo/index.html"],
      outdir: "./public",
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
