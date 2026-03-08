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
  });
}

window.onload = bootstrap;
