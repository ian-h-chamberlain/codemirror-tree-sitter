import { EditorView, basicSetup } from "codemirror";
import { nushell } from "../src";

async function bootstrap() {
  const tgt = document.getElementById("editor_target");

  if (tgt === null) {
    throw new Error("No target for editor!");
  }

  let editor = new EditorView({
    extensions: [basicSetup, await nushell()],
    parent: tgt,
    doc: `#!/usr/bin/env nu

def fibonacci [n: int]: nothing -> list<int> {
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
