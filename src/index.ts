import {
  Language as CMLanguage,
  defineLanguageFacet,
  LanguageSupport,
  LRLanguage,
} from "@codemirror/language";
import {
  Input,
  Parser as LezerParser,
  NodePropSource,
  NodeSet,
  NodeType,
  Parser,
  PartialParse,
  Tree,
  TreeFragment,
} from "@lezer/common";
import { styleTags, Tag } from "@lezer/highlight";
import { Parser as TSParser, Language as TSLanguage } from "web-tree-sitter";

import treeSitterWasm from "web-tree-sitter/web-tree-sitter.wasm";
import nushellWasm from "tree-sitter-nu/tree-sitter-nu.wasm";

import highlights from "./highlights";
import { hoverTooltip, Tooltip, tooltips, TooltipView } from "@codemirror/view";
import { parse } from "node:path/win32";
import { Extension } from "@codemirror/state";

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

    const tsNodeTypes = parser.language?.types || [];
    const nodeTypes = [];
    for (const [id, name] of tsNodeTypes.entries()) {
      nodeTypes.push(NodeType.define({ id, name: name || undefined }));
    }

    // for fields + textMatches, register pseudonode types. Maybe also
    // convert the input maps into arrays for more efficient lookups?

    log.debug(`defined node types`, nodeTypes);
    const nodeSet = new NodeSet(nodeTypes).extend(...this.props);

    return new ParseResult(this.parser, input, pseudoNodes, nodeSet);
  }

  /**
   * An editor extension which shows debug tooltips on hover, showing the names of
   * Lezer nodes. This may be useful when writing `styleTags` for a tree-sitter grammar.
   */
  get debugTooltips(): Extension {
    return hoverTooltip((view, pos): Tooltip | null => {
      const parsedRange = this.startParse(
        view.state.doc.toString(),
        undefined,
        [{ from: pos, to: pos + 1 }],
      );

      const tree = parsedRange.advance();
      if (!tree) {
        return null;
      }

      let iter = tree.resolveStack(pos, 1);
      const dom = document.createElement("span");
      dom.innerText = iter.node.name;
      while (iter.next) {
        // could make this max length configurable or something:
        if (dom.innerText.length > 32) {
          dom.innerText = "…/" + dom.innerText;
          break;
        }
        iter = iter.next;
        dom.innerText = iter.node.name + "/" + dom.innerText;
      }
      if (!iter.next) {
        dom.innerText = "/" + dom.innerText;
      }

      return { pos, create: (): TooltipView => ({ dom }) };
    });
  }
}

class ParseResult implements PartialParse {
  constructor(
    private parser: TSParser,
    private input: Input,
    private pseudoNodes: { [node: string]: PseudoNodes | undefined },
    private nodes: NodeSet,
    public parsedPos: number = 0,
    public stoppedAt: null = null,
  ) {}

  stopAt(_pos: number): void {}

  advance() {
    const language = this.parser.language;
    if (!language) {
      return null;
    }

    const tsTree = this.parser.parse((index, position) =>
      this.input.chunk(index),
    );
    if (!tsTree) {
      return null;
    }

    this.parsedPos = this.input.length;
    log.debug(
      `parsed ${this.input.length} bytes into tree, ranges:`,
      tsTree.getIncludedRanges(),
      "\n" + prettyPrintTree(tsTree.rootNode.toString()),
    );

    const buffer: number[] = [];

    const cursor = tsTree.walk();
    const queue = [cursor.currentDescendantIndex];

    // post-order traversal as specified by Tree.build
    let descendant;
    while ((descendant = queue.pop()) !== undefined) {
      cursor.gotoDescendant(descendant);
      const node = cursor.currentNode;

      const pseudo = this.pseudoNodes[node.type] || {};
      if (
        cursor.currentFieldName &&
        pseudo.fields?.includes(cursor.currentFieldName)
      ) {
        // insert a pseudonode for the field (between the parent and `node`)
      }

      if (pseudo.textMatches) {
        const literalText = this.input.read(cursor.startIndex, cursor.endIndex);
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
      nodeSet: this.nodes,
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
}

export interface PseudoNodes {
  fields?: string[];
  textMatches?: string[];
}

//#endregion

//#region Nushell

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
  const parser = new TreeSitterAdapter(lang, [styleTags(highlights)]);

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

//#endregion

const log = {
  enableDebug: process.env.NODE_ENV !== "production",

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
