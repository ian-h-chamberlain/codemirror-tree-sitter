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
  PartialParse,
  Tree,
  TreeFragment,
} from "@lezer/common";

import treeSitterWasm from "web-tree-sitter/web-tree-sitter.wasm";
import nushellWasm from "@lumis-sh/wasm-nushell/tree-sitter-nushell.wasm";

import { Parser as TSParser, Language as TSLanguage } from "web-tree-sitter";
import { Facet } from "@codemirror/state";

import { LRParser } from "@lezer/lr";
import { styleTags, tags as t } from "@lezer/highlight";

const log = {
  enableDebug: true,

  debug(...rest: any[]) {
    if (this.enableDebug) {
      console.log(...rest);
    }
  },
};

class Parser extends LezerParser {
  tsParser: TSParser;
  props: NodePropSource[];

  constructor(tsLanguage: TSLanguage, props: NodePropSource[]) {
    super();
    this.props = props;
    this.tsParser = new TSParser();
    this.tsParser.setLanguage(tsLanguage);
  }

  createParse(
    input: Input,
    _fragments: readonly TreeFragment[],
    _ranges: readonly { from: number; to: number }[],
  ): PartialParse {
    const parser = this.tsParser;
    const props = this.props;

    // TODO: figure out a way to map TS "fields" -> node props?
    const tsNodeTypes = parser.language?.types || [];
    const nodeTypes = Array.from(tsNodeTypes.entries(), ([id, name]) =>
      NodeType.define({ id, name }),
    );
    log.debug(`defined node types`, nodeTypes);

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
          nodeSet: new NodeSet(nodeTypes).extend(...props),
          topID: tsTree.rootNode.typeId,
        });

        try {
          // this can fail if there are anonymous nodes I guess?
          log.debug(
            `converted result to lezer tree of length ${tree.length}: ${tree}`,
          );
        } catch {}
        return tree;
      }
    })();
  }
}

// helper for tag selectors corresponding to TS (parent [child1 child2] @bar)
function anyChild(parent: string, children: string[]): string {
  return children
    .map((child) => `${escape(parent)}/${escape(child)}`)
    .join(" ");
}

// helper to escape a single tag selector
function escape(s: string): string {
  if (/[/!*".]/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

export async function nushell() {
  await TSParser.init({
    locateFile(scriptName: string, scriptDirectory: string) {
      console.log(`locating ${scriptDirectory}${scriptName}`);
      if (scriptName === "web-tree-sitter.wasm") {
        console.log(`found ${JSON.stringify(treeSitterWasm())}`);
        return treeSitterWasm().filepath;
      }
      return scriptName;
    },
  });

  console.log(`loading language: ${JSON.stringify(nushellWasm())}`);
  const lang = await TSLanguage.load(nushellWasm().filepath);

  // Based roughly on upstream tree-sitter-nu highlights.scm
  // TBD if creating any new tags/modifiers to match the upstream is worth it at all
  const styleRules = {
    "let mut const def": t.definitionKeyword,
    "if else match loop while try catch finally error": t.controlKeyword,
    "module use": t.moduleKeyword,
    "alias export-env export extern": t.keyword, // or moduleKeyword?

    "decl_use/use": t.moduleKeyword,
    "ctrl_for/for ctrl_for/in": t.controlKeyword,

    val_number: t.number,
    "identifier val_duration/unit val_filesize/unit": t.variableName,

    val_binary: t.number,
    [anyChild("val_binary", ["0b", "0o", "0x", "hex_digit"])]: t.number,
    [anyChild("val_binary", ["[", "]"])]: t.number,
    "val_binary/,": t.punctuation,

    val_bool: t.bool,
    val_nothing: t.null,
    val_string: t.string,
    val_date: t.number,

    "inter_escape_sequence escape_sequence": t.escape,
    [anyChild("val_interpolated", ['$"', "$'", '"', "'"])]: t.string,
    "unescaped_interpolated_content escaped_interpolated_content": t.string,
    [anyChild("expr_interpolated", ["(", ")"])]: t.variableName,

    "raw_string_begin raw_string_end": t.special(t.punctuation),

    // TODO: needs to capture operator only, maybe with props
    // "expr_binary": t.operator,
    // "where_predicate": t.operator,

    [anyChild("assignment", ["=", "+=", "-=", "*=", "/=", "++="])]: t.operator,
    [anyChild("expr_unary", ["not", "-"])]: t.operator,
    [anyChild("val_range", ["..", "..=", "..<"])]: t.operator,
    "=> = |": t.operator,

    "o> out> e> err> e+o> err+out> o+e> out+err> o>> out>> e>> err>> e+o>> err+out>> o+e>> out+err>> e>| err>| e+o>| err+out>| o+e>| out+err>|":
      t.operator,

    ", ;": t.special(t.punctuation),

    "param_long_flag/--": t.punctuation,
    "long_flag/--": t.punctuation,
    "short_flag/-": t.punctuation,
    "long_flag/=": t.special(t.punctuation),
    "short_flag/=": t.special(t.punctuation),
    "param_short_flag/-": t.punctuation,

    'param_rest/"..."': t.punctuation,
    "param_type/:": t.special(t.punctuation),
    "param_value/=": t.special(t.punctuation),
    "param_completer/@": t.special(t.punctuation),
    "attribute/@": t.special(t.punctuation),
    "param_opt/?": t.special(t.punctuation),
    "returns/->": t.special(t.punctuation),

    '( ) "...("': t.paren,
    '[ ] "...["': t.squareBracket,
    '{ } "...{"': t.brace,

    // TODO:
    // key: (identifier)
    // (param_rest name: (_))
    // (param_opt name: (_))
    // (parameter param_name: (_))
    "param_completer/cmd_identifier": t.string,
    "param_long_flag/long_flag_identifier": t.attributeName,
    "param_short_flag/param_short_flag_identifier": t.attributeName,
    "attribute/attribute_identifier": t.attributeName,
    "short_flag/short_flag_identifier": t.attributeName,
    long_flag_identifier: t.attributeName,

    "scope_pattern/wild_card": t.function(t.variableName),
    cmd_identifier: t.function(t.variableName),

    // TODO: Skipping builtin command names for now, probably can generate a JSON file
    // and import it or something like that

    // TODO: match specific commands as keywords
    // break, continue, return, do, source, source-env, hide, hide-env, overlay, error, as

    "command/^": t.punctuation,

    where: t.standard(t.function(t.variableName)),
    [anyChild("where_predicate", ["?", "!"])]: t.punctuation,

    path: t.variableName,
    [anyChild("path", [".", "?", "!"])]: t.punctuation,

    "stmt_let/identifier": t.definition(t.variableName),
    [anyChild("val_variable", ["$", "...$"])]: t.special(t.punctuation),
    "val_variable/identifier": t.variableName,
    "val_variable/in": t.special(t.variableName),
    "val_variable/nu": t.namespace,
    "val_variable/env": t.constant(t.variableName),

    "val_cellpath/$": t.special(t.punctuation),
    "record_entry/:": t.special(t.punctuation),

    flat_type: t.typeName,

    "list_type/list": t.typeName,
    [anyChild("list_type", ["<", ">"])]: t.angleBracket,

    [anyChild("collection_type", ["record", "table"])]: t.typeName,
    // TODO: collection_type/key
    [anyChild("collection_type", ["<", ">"])]: t.angleBracket,
    "collection_type/:": t.special(t.punctuation),

    "composite_type/oneof": t.typeName,
    [anyChild("composite_type", ["<", ">"])]: t.angleBracket,

    shebang: t.operatorKeyword, // ?

    comment: t.comment,
    // TODO: "(comment) . (decl_def)": t.docComment,
    "parameter/comment": t.docComment,

    // TODO: injected regex for find/parse etc?
  };

  log.debug(`built style tagging rules`, styleRules);

  // TODO: indent / fold props, etc?
  const parser = new Parser(lang, [styleTags(styleRules)]);
  log.debug(parser.props);

  // TODO: should we export this as well
  const nushellLanguage = new CMLanguage(
    defineLanguageFacet({
      commentTokens: { line: "#" },
    }),
    parser,
    [],
    "nushell",
  );

  return new LanguageSupport(nushellLanguage);
}
