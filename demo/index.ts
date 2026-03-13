import { EditorView, basicSetup } from "codemirror";
import { nushell } from "../src";
import fibonacci from "./fibonacci.nu" with { type: "text" };

async function bootstrap() {
  const tgt = document.getElementById("editor-target");

  if (tgt === null) {
    throw new Error("no target for codemirror editor!");
  }

  let editor = new EditorView({
    extensions: [basicSetup, await nushell()],
    parent: tgt,
    doc: fibonacci,
  });
}

window.onload = bootstrap;
