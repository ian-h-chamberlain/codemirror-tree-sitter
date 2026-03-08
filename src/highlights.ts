import { tags as t } from "@lezer/highlight";

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

// Based roughly on upstream tree-sitter-nu highlights.scm
// TBD if creating any new tags/modifiers to match the upstream is worth it at all
export default {
  "let mut const def": t.definitionKeyword,
  "if else match loop while try catch finally error": t.controlKeyword,
  "module use": t.moduleKeyword,
  "alias export-env export extern": t.keyword, // or moduleKeyword?

  "decl_use/use": t.moduleKeyword,
  "ctrl_for/for ctrl_for/in": t.controlKeyword,

  val_number: t.number,
  identifier: t.variableName,
  "val_duration/duration_unit val_filesize/filesize_unit": t.unit,

  [anyChild("val_binary", ["0b", "0o", "0x", "hex_digit"])]: t.number,
  [anyChild("val_binary", ["[", "]"])]: t.number,
  "val_binary/,": t.punctuation,

  val_bool: t.bool,
  val_nothing: t.null,
  "val_string/...": t.string,
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

  "flat_type/...": t.typeName,

  "list_type/list": t.typeName,
  [anyChild("list_type", ["<", ">"])]: t.angleBracket,

  [anyChild("collection_type", ["record", "table"])]: t.typeName,
  // TODO: collection_type/key
  [anyChild("collection_type", ["<", ">"])]: t.angleBracket,
  "collection_type/:": t.special(t.punctuation),

  "composite_type/oneof": t.typeName,
  [anyChild("composite_type", ["<", ">"])]: t.angleBracket,

  "shebang/...": t.operatorKeyword, // is this right ?

  "comment/...": t.comment,
  // TODO: "(comment) . (decl_def)": t.docComment,
  "parameter/comment/...": t.docComment,

  // TODO: injected regex for find/parse etc?
};
