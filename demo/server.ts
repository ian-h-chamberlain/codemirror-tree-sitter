#!/usr/bin/env bun

import bun from "bun";
import index from "./index.html";

const result = await bun.build({
  entrypoints: ["./demo/index.html"],
  external: ["module"],
});

console.log(result);

// TODO: would be nice to have a "production" server to run from
const serve = bun.serve({
  development: { console: true },
  reusePort: true,
  routes: { "/": index },
});
console.log(`http://${serve.hostname}:${serve.port}`);
