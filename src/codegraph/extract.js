// Language-specific rules for turning a parsed tree into graph data: which node
// types are "definitions" (and their kind), and which are call/reference sites.
// Name resolution is intentionally lightweight — we match references to defs by
// name globally — which is plenty for a local coding agent's navigation.

const JS_DEFS = {
  function_declaration: "function",
  generator_function_declaration: "function",
  class_declaration: "class",
  method_definition: "method",
};
const TS_DEFS = {
  ...JS_DEFS,
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
  abstract_class_declaration: "class",
};

const RULES = {
  javascript: { defs: JS_DEFS, calls: new Set(["call_expression", "new_expression"]) },
  typescript: { defs: TS_DEFS, calls: new Set(["call_expression", "new_expression"]) },
  tsx: { defs: TS_DEFS, calls: new Set(["call_expression", "new_expression"]) },
  python: {
    defs: { function_definition: "function", class_definition: "class" },
    calls: new Set(["call"]),
  },
  go: {
    defs: { function_declaration: "function", method_declaration: "method", type_spec: "type" },
    calls: new Set(["call_expression"]),
  },
  rust: {
    defs: {
      function_item: "function",
      struct_item: "struct",
      enum_item: "enum",
      trait_item: "trait",
      mod_item: "module",
      macro_definition: "macro",
    },
    calls: new Set(["call_expression", "macro_invocation"]),
  },
};

// Extract the plain name a call/new targets. Handles member/selector/field/
// scoped accesses by taking the final segment (e.g. `a.b.c()` → "c").
function calleeName(callNode) {
  // The callee subtree is the "function" field (JS/Py/Go/Rust) or "constructor"
  // (JS new_expression) or "macro" (Rust macro_invocation).
  const target =
    callNode.childForFieldName("function") ||
    callNode.childForFieldName("constructor") ||
    callNode.childForFieldName("macro") ||
    callNode.child(0);
  if (!target) return null;
  return lastName(target);
}

function lastName(node) {
  // Member/attribute accesses expose the trailing name under different field
  // names per grammar: JS "property", Go/Rust "field", Python "attribute".
  for (const field of ["property", "field", "attribute", "name"]) {
    const f = node.childForFieldName?.(field);
    if (f) return f.text;
  }
  if (/identifier$/.test(node.type)) return node.text;
  // Fall back to the last identifier-like descendant.
  let found = null;
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (/identifier$/.test(n.type)) found = n.text;
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i));
  }
  return found;
}

function defName(node) {
  const n = node.childForFieldName("name");
  if (n) return n.text;
  // type_spec (Go) / some rust items expose the name as a type_identifier child.
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (/identifier$/.test(c.type)) return c.text;
  }
  return null;
}

// Is this a `const foo = () => {}` / `const foo = function(){}` style def?
function arrowVarName(node) {
  if (node.type !== "variable_declarator") return null;
  const value = node.childForFieldName("value");
  if (!value) return null;
  if (["arrow_function", "function", "function_expression"].includes(value.type)) {
    const name = node.childForFieldName("name");
    return name ? name.text : null;
  }
  return null;
}

// Parse `source` (already parsed into `tree`) for language `lang`, returning
// { defs, refs }. Each def: { name, kind, startLine, endLine, startIndex,
// endIndex }. Each ref: { name, line, fromIndex } where fromIndex points at the
// enclosing def's startIndex (or null at file scope) so edges can be resolved.
export function extract(tree, lang) {
  const rule = RULES[lang];
  if (!rule) return { defs: [], refs: [] };
  const defs = [];
  const refs = [];
  const scope = []; // stack of enclosing def startIndex

  const walk = (node) => {
    let pushed = false;
    let defKind = rule.defs[node.type];
    let name = null;

    if (defKind) {
      name = defName(node);
    } else {
      const av = arrowVarName(node);
      if (av) {
        defKind = "function";
        name = av;
      }
    }

    if (defKind && name) {
      defs.push({
        name,
        kind: defKind,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startIndex: node.startIndex,
        endIndex: node.endIndex,
      });
      scope.push(node.startIndex);
      pushed = true;
    }

    if (rule.calls.has(node.type)) {
      const cn = calleeName(node);
      if (cn) {
        refs.push({
          name: cn,
          line: node.startPosition.row + 1,
          fromIndex: scope.length ? scope[scope.length - 1] : null,
        });
      }
    }

    for (let i = 0; i < node.childCount; i++) walk(node.child(i));
    if (pushed) scope.pop();
  };

  walk(tree.rootNode);
  return { defs, refs };
}
