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

  const entrypoints: BuildConfig[] = [
    {
      // library
      ...config,
      entrypoints: ["./src"],
      outdir: "./dist",
      root: "./src",
      naming: "[name].[ext]",
      env: "NODE_*",
      sourcemap: true,
    },
    {
      // demo
      ...config,
      entrypoints: ["./demo/index.html"],
      outdir: "./public",
      minify: IS_PRODUCTION,
      sourcemap: !IS_PRODUCTION,
      plugins: [codemirrorPlugin],
    },
  ];

  for (const cfg of entrypoints) {
    const out = await Bun.build(cfg);
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
    tarballs.then((paths) => paths.map(async (p) => await fs.rm(p))),
  ]);
  console.log("Cleaned up outputs");
}

// Seems to be enough to work around some issues like:
// - https://github.com/uiwjs/react-codemirror/issues/707#issuecomment-2630203529
// - https://github.com/oven-sh/bun/issues/26901
const codemirrorPlugin: BunPlugin = {
  name: "codemirror-cjs",
  setup: (build) => {
    build.onResolve({ filter: /^@?codemirror/ }, async (args) => {
      const pkgdir = path.resolve("node_modules", args.path);
      const packageJson = JSON.parse(
        await fs.readFile(path.resolve(pkgdir, "package.json"), {
          encoding: "utf-8",
        }),
      );
      return {
        path: path.resolve(
          pkgdir,
          packageJson.exports.require || packageJson.main,
        ),
      };
    });
  },
};

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
