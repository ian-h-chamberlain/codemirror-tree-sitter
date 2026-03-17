import {
  Language as CMLanguage,
  defineLanguageFacet,
  LanguageSupport,
} from "@codemirror/language";
import { styleTags } from "@lezer/highlight";
import { Parser as TSParser, Language as TSLanguage } from "web-tree-sitter";
import treeSitterWasm from "web-tree-sitter/web-tree-sitter.wasm" with { type: "file" };
import nushellWasm from "tree-sitter-nu/tree-sitter-nu.wasm" with { type: "file" };

import { TreeSitterAdapter } from "codemirror-tree-sitter";

import { pseudonodes, highlights } from "./highlights";

export async function nushellLanguage(): Promise<CMLanguage> {
  await TSParser.init({
    locateFile: () => treeSitterWasm,
  });

  const response = await fetch(nushellWasm);
  const lang = await TSLanguage.load(await response.bytes());

  // TODO: indent / fold props, etc?

  const languageData = defineLanguageFacet({
    commentTokens: { line: "#" },
  });

  const parser = new TreeSitterAdapter(
    lang,
    [styleTags(highlights)],
    pseudonodes,
  );

  return new CMLanguage(languageData, parser, [], "nushell");
}

export async function nushell({
  debugTooltips = false,
} = {}): Promise<LanguageSupport> {
  const lang = await nushellLanguage();
  const parser = lang.parser as TreeSitterAdapter;

  return new LanguageSupport(lang, {
    extension: debugTooltips ? [parser.debugTooltips] : [],
  });
}
