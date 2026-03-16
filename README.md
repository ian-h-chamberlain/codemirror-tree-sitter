# CodeMirror 6 language package for Nushell

Based loosely on <https://github.com/codemirror/lang-example>, but uses
[`tree-sitter-nu`](https://github.com/nushell/tree-sitter-nu) WASM as a "custom" parser 
instead of creating a new Lezer grammar.

WIP!

<!-- TODO: Maybe bundle into index.html automatically -->

## [Live Demo](https://ian-h-chamberlain.com/codemirror-lang-nushell/)

This uses
- A basic [CodeMirror 6](https://codemirror.net) editor
- [tree-sitter-nu](https://github.com/nushell/tree-sitter-nu)
- a bit of glue code to convert tree-sitter types to [Lezer](https://lezer.codemirror.net/) types
- bundled together and pushed up to GitHub pages

Note that you can't actually run any code with this, all the highlighting happens locally in your browser!

Check out the [source code](https://github.com/ian-h-chamberlain/codemirror-lang-nushell).

## Notes

There are some caveats to this approach:

1. For now, no incremental parsing is performed.

1. Lezer doesn't support some more advanced features that tree-sitter does:
  - fields (e.g. `(object key: (_))`)
  - anchoring (e.g. `(command (name) . (arg))`
  - text matching (e.g. `#eq?`, `#any-of?`, `#match?`)
    - anonymous nodes are still supported, things like punctionation should still work
  
  To workaround some of these, the adapter code has the ability to inject some
  fake "pseudonodes" that perform a similar function.
  For example, these tree-sitter query that uses fields and matching:
  
  ```scm
  (expr_binary
    opr: _ @operator)
    
  ((function) @keyword
    (#any-of? @keyword "any" "all" "int"))
  ```
  
  The calling code can tell the adapter to create pseudonodes for `opr` fields
  of an `expr_binary` node with some extra configuration, and for `function`
  nodes which have the literal content `any`, `all`, or `int`:
  
  ```ts
  new TreeSitterAdapter(
    language,
    [styleTags({ 
      "expr_binary/opr:/...": t.operator,
      "function/`any` function/`all`, function/`int`": t.keyword,
    })],
    {
      expr_binary: { fields: ["opr"] },
      function: { textMatches: ["any", "all", "int"] },
    },
  )
  ```
