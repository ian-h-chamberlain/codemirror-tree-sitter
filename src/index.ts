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
import { captureRejectionSymbol } from "node:stream";

//#region Adapter

export class TreeSitterAdapter extends LezerParser {
  parser: TSParser;

  // bleh, this is a super long docstring and I don't love it but wanted to write some notes;
  /**
   * @param fields the names of fields to generate psuedonodes for when  translating
   *    from tree-sitter to Lezer. The generated nodes will have names like `foo:` for
   *    a field named `foo`.
   *
   *    The resulting parser can use a style rule like `parent/foo:/bar` to simulate a
   *    tree-sitter query like `(parent foo: (bar) @bar)`.
   *
   *    Note that due to the presence of these pseudonodes, style rules must *always*
   *    include them, e.g. `parent/bar` will not match if the `foo` field was specified.
   *
   * @param textMatches for each key, generate additional pseudonode types for
   *    the given strings, which will be output if the node's text content matches.
   *    The generated nodes will have names like `'foo'` for a given string `"foo"`.
   *
   *    The resulting parser can use a style rule like `foo/'bar'` to simulate a tree-sitter
   *    query like `((foo) @foo (#eq? @foo "bar"))`
   *
   * @example
   *    import { tags } from "@lezer/highlight";
   *
   *    const parser = new Parser({
   *        pseudoNodes: {
   *            fields: { parent: ["a"] },
   *            textMatches: { bar: ["baz"] },
   *        },
   *        props: [styleTags({
   *          "parent/a:/*": tags.typeName,
   *          "parent/bar/'baz'": tags.string,
   *        })]
   *    })
   */
  constructor(
    language: TSLanguage,
    private props: NodePropSource[] = [],
    private pseudoNodes: { [node: string]: PseudoNodes | undefined } = {},
  ) {
    super();
    this.parser = new TSParser();
    this.parser.setLanguage(language);
  }

  createParse(
    input: Input,
    _fragments: readonly TreeFragment[],
    _ranges: readonly { from: number; to: number }[],
  ): PartialParse {
    const { parser, pseudoNodes } = this;

    // TODO: figure out a way to map TS fields -> node props?
    // https://tree-sitter.github.io/tree-sitter/creating-parsers/3-writing-the-grammar.html#using-fields
    // It might be possible with

    const tsNodeTypes = parser.language?.types || [];
    const nodeTypes = [];
    for (const [id, name] of tsNodeTypes.entries()) {
      nodeTypes.push(NodeType.define({ id, name: name || undefined }));
    }

    // for fields + textMatches, register pseudonode types. Maybe also
    // convert the input maps into arrays for more efficient lookups?

    log.debug(`defined node types`, nodeTypes);
    const nodeSet = new NodeSet(nodeTypes).extend(...this.props);

    // TODO: move this helper class out to top-level
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

          const pseudo = pseudoNodes[node.type] || {};
          if (
            cursor.currentFieldName &&
            pseudo.fields?.includes(cursor.currentFieldName)
          ) {
            // insert a pseudonode for the field (between the parent and `node`)
          }

          if (pseudo.textMatches) {
            const literalText = input.read(cursor.startIndex, cursor.endIndex);
            if (pseudo.textMatches?.includes(literalText)) {
              // insert a pseudonode for the matched thing. Are these always
              // gonna be leaf nodes or do we need to pick a firstChild or something
            }
          }

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

export interface PseudoNodes {
  fields?: string[];
  textMatches?: string[];
}

//#endregion

//#region Nushell

export async function nushellLanguage(): Promise<CMLanguage> {
  await TSParser.init({
    locateFile(scriptName: string, scriptDirectory: string) {
      log.debug(`locating ${scriptDirectory}${scriptName}`);
      if (scriptName === "web-tree-sitter.wasm") {
        log.debug(`found ${JSON.stringify(treeSitterWasm())}`);
        return treeSitterWasm().filepath;
      }
      return scriptName;
    },
  });

  log.debug(`loading language: ${JSON.stringify(nushellWasm())}`);
  const lang = await TSLanguage.load(nushellWasm().filepath);

  // TODO: indent / fold props, etc?

  log.debug(`applying style tag rules`, highlights);
  const languageData = defineLanguageFacet({
    commentTokens: { line: "#" },
  });
  const adapter = new TreeSitterAdapter(lang, [styleTags(highlights)]);
  return new CMLanguage(languageData, adapter, [], "nushell");
}

export async function nushell(): Promise<LanguageSupport> {
  return new LanguageSupport(await nushellLanguage());
}

//#endregion

const log = {
  enableDebug: false,

  debug(...rest: any[]) {
    if (this.enableDebug) {
      console.log(...rest);
    }
  },

  error(...rest: any[]) {
    console.error(...rest);
  },
};

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
