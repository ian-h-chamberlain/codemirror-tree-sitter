#!/usr/bin/env nu

cd $env.FILE_PWD

let input = 'fibonacci.nu'
[
  { file: dark.html, dark: true }
  { file: light.html, dark: false }
] | par-each {|it|
  open $input
    | nu-highlight
    | to html --html-color --partial --dark=$it.dark
    | save --force $it.file
  print $"Generated ($input) -> ($it.file)"
} | ignore
