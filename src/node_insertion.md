Tree:

```scm
(root
  (nu_script
    (shebang ("#!"))
    (comment ("#"))
    (decl_def (attribute_list (attribute)))))
```
    
Post-order buffer:
```
0   [attribute, 1]
1   [attrib_list, 2]
2   [decl_def, 3]
3   ["#", 2]
4   [comment, 2]
5   ["#!, 1]
6   [shebang, 2]
7   [nu_script, 8]
8   [root, 9]
```

[`foo.bar`](http://example.com)

To insert between "nu_script" and "comment"

- `parent_idx = 7`
- `child_idx = 4`
- `desc_count = child.desc_count + 1 = 3`

1. insert after child_idx:
    
    ```
    0   [attribute, 1]
    1   [attrib_list, 2]
    2   [decl_def, 3]
    3   ["#", 2]
    4   [comment, 3]
    5   [new_node, 3]
    6   ["#!, 1]
    7   [shebang, 2]
    8   [nu_script, 8]
    9   [root, 9]
    ```

2. Update ancestors' descendant counts:

    ```rs
    for i in (1..child_idx).rev() {
        
    }
    ```

    ```
    0   [attribute, 1]
    1   [attrib_list, 2]
    2   [decl_def, 3]
    3   ["#", 2]
    4   [comment, 3]
    5   [new_node, 3]
    6   ["#!, 1]
    7   [shebang, 2]
    8   [nu_script, 9]
    9   [root, 10]
    ```
