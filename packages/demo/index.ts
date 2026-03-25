import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  KeyBinding,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { monokai } from "@fsegurai/codemirror-theme-monokai";
import { tokyoNightDay } from "@fsegurai/codemirror-theme-tokyo-night-day";
import { vim as vimKeymap } from "@replit/codemirror-vim";

import { nushell } from "codemirror-lang-nushell";

import darkCodeSample from "./code-samples/dark.html" with { type: "text" };
import lightCodeSample from "./code-samples/light.html" with { type: "text" };
import fibonacci from "./code-samples/fibonacci.nu" with { type: "text" };

const THEMES: {
  Dark: Extension;
  Light: Extension;
  [key: string]: Extension | undefined;
} = {
  Dark: monokai,
  Light: tokyoNightDay,
};

async function bootstrap() {
  const codeSample = document.getElementById("code-sample");
  if (codeSample) {
    codeSample.innerHTML = darkCodeSample as unknown as string;
  }

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
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
      ] as KeyBinding[]),
    ],
  });

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
  themeSelector.addEventListener("change", () => {
    // TODO: update the whole page's prefers-color-scheme, everything else should
    // follow from that I think (rather than doing some custom thing)

    const newTheme = THEMES[themeSelector.value];
    if (newTheme) {
      console.log("new theme:", themeSelector.value);
      editor.dispatch({
        effects: themeCfg.reconfigure(newTheme),
      });

      if (codeSample) {
        switch (newTheme) {
          case THEMES.Dark:
            codeSample.innerHTML = darkCodeSample as unknown as string;
            break;
          case THEMES.Light:
            codeSample.innerHTML = lightCodeSample as unknown as string;
            break;
        }
      }
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

  const nu = await nushell({ debugTooltips: true });

  // Do this last after all the other (synchronous) setup so
  // that loading the wasm doesn't block rendering the editor
  editor.dispatch({
    effects: nushellExtension.reconfigure([nu]),
  });
}

window.onload = bootstrap;
