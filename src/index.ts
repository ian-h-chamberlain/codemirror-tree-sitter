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

import { pseudonodes, highlights } from "./highlights";
import { hoverTooltip, Tooltip, tooltips, TooltipView } from "@codemirror/view";
import { parse } from "node:path/win32";
import { Extension } from "@codemirror/state";

//#region Adapter

export class TreeSitterAdapter extends LezerParser {
  private parser: TSParser;

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
    private pseudonodes: { [node: string]: PseudoNodeOptions | undefined } = {},
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
    const { parser, pseudonodes: pseudoNodes } = this;

    const tsNodeTypes = parser.language?.types || [];
    const nodeTypes: NodeType[] = [];
    for (const [id, name] of tsNodeTypes.entries()) {
      nodeTypes.push(NodeType.define({ id, name: name || undefined }));
    }

    let pseudo: { [parent: string]: PseudoNodes } = {};
    for (const [parent, cfg] of Object.entries(pseudoNodes || {})) {
      pseudo[parent] = pseudo[parent] || { fields: {}, textMatches: {} };

      for (const name of cfg?.fields || []) {
        const id = nodeTypes.length;
        pseudo[parent].fields[name] = id;
        nodeTypes.push(NodeType.define({ id, name: name + ":" }));
      }

      for (const match of cfg?.textMatches || []) {
        const id = nodeTypes.length;
        pseudo[parent].textMatches[match] = id;
        nodeTypes.push(NodeType.define({ id, name: "`" + match + "`" }));
      }
    }

    log.debug(`defined node types`, nodeTypes);
    const nodeSet = new NodeSet(nodeTypes).extend(...this.props);

    return new ParseResult(this.parser, input, nodeSet, pseudo);
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
    private nodes: NodeSet,
    private pseudonodes: { [node: string]: PseudoNodes },
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
    const queue: { index: number; parent?: string }[] = [
      { index: cursor.currentDescendantIndex },
    ];

    const pseudonodes = [];

    // post-order traversal as specified by Tree.build
    let descendant;
    while ((descendant = queue.pop()) !== undefined) {
      cursor.gotoDescendant(descendant.index);
      const node = cursor.currentNode;

      const parentPseudo = this.pseudonodes[descendant.parent || ""];
      let id;
      if (
        (id = parentPseudo?.fields[cursor.currentFieldName || ""]) !== undefined
      ) {
        insertNode(
          buffer,
          {
            typeId: id,
            startIndex: node.startIndex,
            endIndex: node.endIndex,
            descendantCount: node.descendantCount + 1,
          },
          true,
        );
      }

      insertNode(buffer, node);

      const pseudo = this.pseudonodes[node.type];
      const literalText = this.input.read(cursor.startIndex, cursor.endIndex);
      if ((id = pseudo?.textMatches[literalText]) !== undefined) {
        // set the real node as an ancestor
        buffer[3]! += 4;

        insertNode(
          buffer,
          {
            typeId: id,
            startIndex: node.startIndex,
            endIndex: node.endIndex,
            descendantCount: node.descendantCount,
          },
          true,
        );
      }

      // TODO(perf): might need to use field indices instead of names here
      if (cursor.gotoFirstChild()) {
        queue.push({
          index: cursor.currentDescendantIndex,
          parent: node.type,
        });
        while (cursor.gotoNextSibling()) {
          queue.push({
            index: cursor.currentDescendantIndex,
            parent: node.type,
          });
        }
      }

      if (log.enableDebug) {
        const buf = [];
        for (let i = 0; i < buffer.length; i += 4) {
          const id = buffer[i]!;
          const name = this.nodes.types[id]?.name;
          buf.push({ name, desc: (buffer[i + 3] || 0) / 4 });
        }

        log.debug(buf);
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

export interface PseudoNodeOptions {
  fields?: string[];
  textMatches?: string[];
}

interface PseudoNodes {
  fields: { [name: string]: number };
  textMatches: { [match: string]: number };
}

function insertNode(
  buf: number[],
  node: {
    typeId: number;
    startIndex: number;
    endIndex: number;
    descendantCount: number;
  },
  updateAncestors: boolean = false,
) {
  buf.unshift(
    node.typeId,
    node.startIndex,
    node.endIndex,
    4 * node.descendantCount,
  );

  if (updateAncestors) {
    for (let i = 1; i < buf.length / 4; i++) {
      const offset = 4 * i + 3;
      const descendantCount = (buf[offset] || 0) / 4 - 1;
      const isAncestor = descendantCount >= i;
      if (isAncestor) {
        buf[offset]! += 4;
      }
    }
  }
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

  log.debug(`applying style tag rules`, highlights, pseudonodes);
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
