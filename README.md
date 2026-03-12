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
