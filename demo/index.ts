import { defaultKeymap, historyKeymap, history } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  KeyBinding,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { monokai } from "@fsegurai/codemirror-theme-monokai";
import { tokyoNightDay } from "@fsegurai/codemirror-theme-tokyo-night-day";
import { basicSetup, EditorView } from "codemirror";
import { vim as vimKeymap } from "@replit/codemirror-vim";
import { Compartment, EditorState, Extension } from "@codemirror/state";

import { nushell } from "../src";
import fibonacci from "./fibonacci.nu" with { type: "text" };

const THEMES: {
  Dark: Extension;
  Light: Extension;
  [key: string]: Extension | undefined;
} = {
  Dark: monokai,
  Light: tokyoNightDay,
};

async function bootstrap() {
  const editorTarget = document.getElementById("editor-target");

  if (editorTarget === null) {
    throw new Error("no target for codemirror editor!");
  }

  const vimCfg = new Compartment();
  const themeCfg = new Compartment();
  const nushellExtension = new Compartment();

  const editor = new EditorView({
    doc: fibonacci,
    parent: editorTarget,
    extensions: [
      basicSetup,
      vimCfg.of([vimKeymap({ status: true })]),
      themeCfg.of(THEMES.Dark),
      nushellExtension.of([]),
      bracketMatching(),
      crosshairCursor(),
      drawSelection(),
      dropCursor(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      highlightSelectionMatches(),
      highlightSpecialChars(),
      history(),
      indentOnInput(),
      lineNumbers(),
      // TODO: hoverTooltip() for debugging?
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
      ] as KeyBinding[]),
    ],
  });
  console.log("built editor");

  const themeSelector = document.getElementById(
    "settings-theme",
  ) as HTMLSelectElement;

  if (themeSelector && themeSelector.length < 1) {
    // populate initial values
    themeSelector.remove(0);
    for (const theme of Object.keys(THEMES)) {
      const opt = document.createElement("option");
      opt.value = theme;
      opt.innerText = theme;
      themeSelector.add(opt);
    }
  }
  themeSelector.addEventListener("change", (event) => {
    const newTheme = THEMES[themeSelector.value];
    if (newTheme) {
      console.log("new theme:", themeSelector.value);
      editor.dispatch({
        effects: themeCfg.reconfigure(newTheme),
      });
    }
  });

  const vimSelector = document.getElementById(
    "settings-vim",
  ) as HTMLInputElement;
  vimSelector.addEventListener("change", () => {
    console.log("vim toggled:", vimSelector.checked);
    editor.dispatch({
      effects: vimCfg.reconfigure(
        vimSelector.checked ? [vimKeymap({ status: true })] : [],
      ),
    });
  });

  // Do this last after all the other (synchronous) setup so
  // that loading the wasm doesn't block rendering the editor
  editor.dispatch({
    effects: nushellExtension.reconfigure([await nushell()]),
  });
}

window.onload = bootstrap;
