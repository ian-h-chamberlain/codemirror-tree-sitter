import { EditorView, basicSetup } from "codemirror";
import { nushell } from "../src";

// Get esbuild to copy file, `require` prevents treeshaking. I wonder if
// there's a better way to "cause side effects" somehow.
import html from "./index.html";
if (html) console.log(html);

async function bootstrap() {
  const tgt = document.getElementById("editor_target");

  if (tgt === null) {
    throw new Error("No target for editor!");
  }

  let editor = new EditorView({
    extensions: [basicSetup, await nushell()],
    parent: tgt,
    doc: `#!/usr/bin/env nu

# Generate the fibonacci sequence
@example "basic" { fib 5 } --result [0, 1, 1, 2, 3, 5]
 def fibonacci [
    n: int # How many numbers to generate.
]: nothing -> list<int> {
    mut a = 0
    mut b = 1
    mut result = []

    for _ in 0..$n {
        $result = ($result | append $a)
        let temp = $a + $b
        $a = $b
        $b = $temp
    }

    $result
}

fibonacci 10 | each { |n| print $n }
`,
  });
}

window.onload = bootstrap;
