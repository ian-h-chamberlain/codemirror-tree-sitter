import {
  Language as CMLanguage,
  defineLanguageFacet,
  LanguageSupport,
} from "@codemirror/language";
import {
  Input,
  Parser as LezerParser,
  NodePropSource,
  NodeSet,
  NodeType,
  PartialParse,
  Tree,
  TreeFragment,
} from "@lezer/common";
import { styleTags, Tag } from "@lezer/highlight";
import { Parser as TSParser, Language as TSLanguage } from "web-tree-sitter";

import treeSitterWasm from "web-tree-sitter/web-tree-sitter.wasm";
import nushellWasm from "@lumis-sh/wasm-nushell/tree-sitter-nushell.wasm";

import highlights from "./highlights";

// Hack to let esbuild watch its own config
import "./esbuild.config";

const log = {
  enableDebug: true,

  debug(...rest: any[]) {
    if (this.enableDebug) {
      console.log(...rest);
    }
  },

  error(...rest: any[]) {
    console.error(...rest);
  },
};

class Parser extends LezerParser {
  tsParser: TSParser;

  constructor(
    tsLanguage: TSLanguage,
    public props: NodePropSource[],
  ) {
    super();
    this.tsParser = new TSParser();
    this.tsParser.setLanguage(tsLanguage);
  }

  createParse(
    input: Input,
    _fragments: readonly TreeFragment[],
    _ranges: readonly { from: number; to: number }[],
  ): PartialParse {
    const parser = this.tsParser;

    // TODO: figure out a way to map TS fields -> node props?
    // https://tree-sitter.github.io/tree-sitter/creating-parsers/3-writing-the-grammar.html#using-fields
    // It might be possible with

    const tsNodeTypes = parser.language?.types || [];
    const nodeTypes = [];
    for (const [id, name] of tsNodeTypes.entries()) {
      nodeTypes.push(NodeType.define({ id, name: name || undefined }));
    }

    log.debug(`defined node types`, nodeTypes);
    const nodeSet = new NodeSet(nodeTypes).extend(...this.props);

    return new (class ParseResult implements PartialParse {
      parsedPos: number;
      stoppedAt: null;

      constructor() {
        this.parsedPos = 0;
        this.stoppedAt = null;
      }

      stopAt(_pos: number): void {}

      advance() {
        const language = parser.language;
        if (!language) {
          return null;
        }

        const tsTree = parser.parse((index, position) => input.chunk(index));
        if (!tsTree) {
          return null;
        }

        this.parsedPos = input.length;
        log.debug(
          `parsed ${input.length} bytes into tree, ranges:`,
          tsTree.getIncludedRanges(),
          "\n" + prettyPrintTree(tsTree.rootNode.toString()),
        );

        const buffer = [];

        const cursor = tsTree.walk();
        const queue = [cursor.currentDescendantIndex];

        // post-order traversal as specified by Tree.build
        let descendant;
        while ((descendant = queue.pop()) !== undefined) {
          cursor.gotoDescendant(descendant);
          const node = cursor.currentNode;
          buffer.unshift(
            ...[
              node.typeId,
              node.startIndex,
              node.endIndex,
              4 * node.descendantCount,
            ],
          );

          if (cursor.gotoFirstChild()) {
            queue.push(cursor.currentDescendantIndex);
            while (cursor.gotoNextSibling()) {
              queue.push(cursor.currentDescendantIndex);
            }
          }
        }

        const tree = Tree.build({
          buffer,
          nodeSet,
          topID: tsTree.rootNode.typeId,
        });

        try {
          log.debug(
            `converted result to lezer tree of length ${tree.length}\n`,
            prettyPrintTree(tree.toString()),
          );
        } catch (err) {
          // this can fail if there are certain anonymous node types I guess?
          log.error(err);
        }

        return tree;
      }
    })();
  }
}

// Dumb simple reformatter for parse trees, operates on s-expr strings so it
// works for both types of tree, and doesn't try to be too clever
function prettyPrintTree(s: string): string {
  const tab = "  ";
  let indent = 0;
  let resultLines: string[] = [];
  let inStr = false;

  for (const c of s) {
    if (!inStr) {
      if (c === "(") {
        resultLines.push(tab.repeat(indent));
        indent++;
      } else if (c === ")") {
        indent--;
      }
    }

    if (c === '"') {
      inStr = !inStr;
    }

    if (c === "," && !inStr) {
      resultLines[resultLines.length - 1] += " ";
    } else {
      resultLines[resultLines.length - 1] += c;
    }
  }

  return resultLines.join("\n");
}

export async function nushellLanguage(): Promise<CMLanguage> {
  // NOTE: does this library node-incompatible? can we loader this
  await TSParser.init({
    locateFile: () => treeSitterWasm,
  });

  log.debug(`loading language: ${JSON.stringify(nushellWasm)}`);
  const response = await fetch(nushellWasm);
  const lang = await TSLanguage.load(await response.bytes());

  // TODO: indent / fold props, etc?

  const languageData = defineLanguageFacet({
    commentTokens: { line: "#" },
  });

  log.debug(`applying style tag rules`, highlights);
  const parser = new Parser(lang, [styleTags(highlights)]);
  log.debug(parser.props);

  return new CMLanguage(languageData, parser, [], "nushell");
}

export async function nushell(): Promise<LanguageSupport> {
  return new LanguageSupport(await nushellLanguage());
}
