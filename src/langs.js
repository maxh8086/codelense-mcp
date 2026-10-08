// Language registry. Pure data: which Tree-sitter node types are definitions, calls, imports,
// heritage clauses and type references for each language. extract.js interprets this.
//
// defs values: 'Kind' or { kind, by:{field,map}, keywords:{tokenType:Kind} }.
// calls values: { callee:'field' } for a composite callee expression, or { name:'field', recv:'field' }
// when name and receiver are separate fields (Java, PHP, Ruby).
// heritage entries: { field | type, rel:'INHERITS'|'IMPLEMENTS' }.

const JS_BASE = {
  defs: {
    function_declaration: 'Function',
    generator_function_declaration: 'Function',
    class_declaration: 'Class',
    method_definition: 'Method',
  },
  declarators: {
    variable_declarator: { name: 'name', value: 'value' },
    public_field_definition: { name: 'name', value: 'value' },
    field_definition: { name: 'property', value: 'value' },
  },
  declaratorValues: ['arrow_function', 'function_expression', 'function', 'generator_function'],
  calls: {
    call_expression: { callee: 'function' },
    new_expression: { callee: 'constructor' },
  },
  importTypes: ['import_statement', 'export_statement'],
  importCalls: ['require'],
  commentTypes: ['comment'],
  routes: true,
};

const TS_EXTRA = {
  defs: {
    ...JS_BASE.defs,
    abstract_class_declaration: 'Class',
    interface_declaration: 'Interface',
    enum_declaration: 'Enum',
    type_alias_declaration: 'Type',
  },
  heritage: [
    { type: 'extends_clause', rel: 'INHERITS' },
    { type: 'extends_type_clause', rel: 'INHERITS' },
    { type: 'implements_clause', rel: 'IMPLEMENTS' },
  ],
  typeRefs: ['type_identifier'],
};

export const LANGS = {
  javascript: {
    ...JS_BASE, exts: ['.js', '.mjs', '.cjs', '.jsx'], wasm: 'javascript',
    heritage: [{ type: 'class_heritage', rel: 'INHERITS' }],
  },
  typescript: { ...JS_BASE, ...TS_EXTRA, exts: ['.ts', '.mts', '.cts'], wasm: 'typescript' },
  tsx: { ...JS_BASE, ...TS_EXTRA, exts: ['.tsx'], wasm: 'tsx' },
  python: {
    exts: ['.py', '.pyi'], wasm: 'python',
    defs: { function_definition: 'Function', class_definition: 'Class' },
    calls: { call: { callee: 'function' } },
    importTypes: ['import_statement', 'import_from_statement'],
    heritage: [{ field: 'superclasses', rel: 'INHERITS' }],
    commentTypes: ['comment'],
    pythonDocstrings: true,
    decoratedRoutes: true,
  },
  go: {
    exts: ['.go'], wasm: 'go',
    defs: {
      function_declaration: 'Function',
      method_declaration: 'Method',
      type_spec: { kind: 'Type', by: { field: 'type', map: { struct_type: 'Class', interface_type: 'Interface' } } },
    },
    calls: { call_expression: { callee: 'function' } },
    importTypes: ['import_spec'],
    typeRefs: ['type_identifier'],
    commentTypes: ['comment'],
    methodOwner: 'go',
  },
  java: {
    exts: ['.java'], wasm: 'java',
    defs: {
      class_declaration: 'Class', record_declaration: 'Class', interface_declaration: 'Interface',
      enum_declaration: 'Enum', annotation_type_declaration: 'Interface',
      method_declaration: 'Method', constructor_declaration: 'Method',
    },
    calls: {
      method_invocation: { name: 'name', recv: 'object' },
      object_creation_expression: { callee: 'type' },
    },
    importTypes: ['import_declaration'],
    heritage: [
      { field: 'superclass', rel: 'INHERITS' },
      { field: 'interfaces', rel: 'IMPLEMENTS' },
      { type: 'extends_interfaces', rel: 'INHERITS' },
    ],
    typeRefs: ['type_identifier'],
    commentTypes: ['line_comment', 'block_comment'],
  },
  c_sharp: {
    exts: ['.cs'], wasm: 'c_sharp',
    defs: {
      class_declaration: 'Class', record_declaration: 'Class', struct_declaration: 'Class',
      interface_declaration: 'Interface', enum_declaration: 'Enum',
      method_declaration: 'Method', constructor_declaration: 'Method', local_function_statement: 'Function',
    },
    calls: {
      invocation_expression: { callee: 'function' },
      object_creation_expression: { callee: 'type' },
    },
    importTypes: ['using_directive'],
    heritage: [{ type: 'base_list', rel: 'INHERITS', ifacePrefix: true }],
    commentTypes: ['comment'],
  },
  c: {
    exts: ['.c', '.h'], wasm: 'c',
    defs: {
      function_definition: 'Function', struct_specifier: 'Class', enum_specifier: 'Enum',
      type_definition: 'Type', union_specifier: 'Class',
    },
    calls: { call_expression: { callee: 'function' } },
    importTypes: ['preproc_include'],
    typeRefs: ['type_identifier'],
    commentTypes: ['comment'],
    requireBody: ['struct_specifier', 'enum_specifier', 'union_specifier'],
  },
  cpp: {
    exts: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'], wasm: 'cpp',
    defs: {
      function_definition: 'Function', class_specifier: 'Class', struct_specifier: 'Class',
      enum_specifier: 'Enum', type_definition: 'Type', union_specifier: 'Class',
    },
    calls: { call_expression: { callee: 'function' }, new_expression: { callee: 'type' } },
    importTypes: ['preproc_include'],
    heritage: [{ type: 'base_class_clause', rel: 'INHERITS' }],
    typeRefs: ['type_identifier'],
    commentTypes: ['comment'],
    requireBody: ['struct_specifier', 'class_specifier', 'enum_specifier', 'union_specifier'],
  },
  rust: {
    exts: ['.rs'], wasm: 'rust',
    defs: {
      function_item: 'Function', function_signature_item: 'Function', struct_item: 'Class',
      enum_item: 'Enum', trait_item: 'Interface', type_item: 'Type', union_item: 'Class',
    },
    containers: { impl_item: { nameField: 'type', implementsField: 'trait' } },
    calls: { call_expression: { callee: 'function' }, macro_invocation: { callee: 'macro' } },
    importTypes: ['use_declaration'],
    typeRefs: ['type_identifier'],
    commentTypes: ['line_comment', 'block_comment'],
  },
  php: {
    exts: ['.php'], wasm: 'php',
    defs: {
      class_declaration: 'Class', interface_declaration: 'Interface', trait_declaration: 'Class',
      enum_declaration: 'Enum', function_definition: 'Function', method_declaration: 'Method',
    },
    calls: {
      function_call_expression: { callee: 'function' },
      member_call_expression: { name: 'name', recv: 'object' },
      scoped_call_expression: { name: 'name', recv: 'scope' },
    },
    importTypes: [
      'namespace_use_declaration', 'include_expression', 'include_once_expression',
      'require_expression', 'require_once_expression',
    ],
    heritage: [
      { type: 'base_clause', rel: 'INHERITS' },
      { type: 'class_interface_clause', rel: 'IMPLEMENTS' },
    ],
    commentTypes: ['comment'],
  },
  ruby: {
    exts: ['.rb'], wasm: 'ruby',
    defs: { class: 'Class', module: 'Class', method: 'Method', singleton_method: 'Method' },
    calls: { call: { name: 'method', recv: 'receiver' } },
    importCalls: ['require', 'require_relative', 'load'],
    heritage: [{ field: 'superclass', rel: 'INHERITS' }],
    commentTypes: ['comment'],
  },
  kotlin: {
    exts: ['.kt', '.kts'], wasm: 'kotlin',
    defs: {
      class_declaration: { kind: 'Class', keywords: { interface: 'Interface' } },
      object_declaration: 'Class', function_declaration: 'Function',
    },
    calls: { call_expression: { callee: null } },
    importTypes: ['import_header'],
    heritage: [{ type: 'delegation_specifier', rel: 'IMPLEMENTS', ctorInherits: true }],
    typeRefs: ['type_identifier'],
    commentTypes: ['line_comment', 'multiline_comment'],
  },
  swift: {
    exts: ['.swift'], wasm: 'swift',
    defs: {
      class_declaration: { kind: 'Class', keywords: { enum: 'Enum' } },
      protocol_declaration: 'Interface', function_declaration: 'Function',
    },
    calls: { call_expression: { callee: null } },
    importTypes: ['import_declaration'],
    heritage: [{ type: 'inheritance_specifier', rel: 'INHERITS' }],
    typeRefs: ['type_identifier'],
    commentTypes: ['comment', 'multiline_comment'],
  },
  scala: {
    exts: ['.scala', '.sc'], wasm: 'scala',
    defs: {
      class_definition: 'Class', object_definition: 'Class', trait_definition: 'Interface',
      function_definition: 'Function', function_declaration: 'Function',
    },
    calls: { call_expression: { callee: 'function' } },
    importTypes: ['import_declaration'],
    heritage: [{ type: 'extends_clause', rel: 'INHERITS' }],
    typeRefs: ['type_identifier'],
    commentTypes: ['comment', 'block_comment'],
  },
  dart: {
    exts: ['.dart'], wasm: 'dart',
    defs: {
      class_definition: 'Class', enum_declaration: 'Enum', mixin_declaration: 'Class',
      function_signature: 'Function',
    },
    importTypes: ['import_or_export', 'library_import'],
    commentTypes: ['comment', 'documentation_comment'],
    extendToSibling: 'function_body',
  },
  lua: {
    exts: ['.lua'], wasm: 'lua',
    defs: { function_declaration: 'Function' },
    calls: { function_call: { callee: 'name' } },
    importCalls: ['require'],
    commentTypes: ['comment'],
  },
  bash: {
    exts: ['.sh', '.bash', '.zsh'], wasm: 'bash',
    defs: { function_definition: 'Function' },
    calls: { command: { callee: 'name' } },
    commentTypes: ['comment'],
  },
  html: { exts: ['.html', '.htm'], wasm: 'html', defs: {} },
  css: { exts: ['.css', '.scss'], wasm: 'css', defs: {} },
  // Config/schema files: File + Resource node, top-level keys only (no grammar needed).
  json: { exts: ['.json'], resource: 'json' },
  yaml: { exts: ['.yaml', '.yml'], resource: 'keys' },
  toml: { exts: ['.toml'], resource: 'keys' },
  // Regex-based "lite" extraction for languages whose grammar is not bundled.
  sql: {
    exts: ['.sql'],
    lite: [
      { re: /^\s*create\s+(?:or\s+replace\s+)?(?:temporary\s+|temp\s+|materialized\s+)?(table|view)\s+(?:if\s+not\s+exists\s+)?([\w."`\[\]]+)/gim, kind: 'Type', nameGroup: 2, end: 'semicolon' },
      { re: /^\s*create\s+(?:or\s+replace\s+)?(function|procedure|trigger)\s+([\w."`\[\]]+)/gim, kind: 'Function', nameGroup: 2, end: 'semicolon' },
    ],
  },
  graphql: {
    exts: ['.graphql', '.gql'],
    lite: [
      { re: /^\s*(?:extend\s+)?(type|input)\s+(\w+)/gm, kind: 'Type', nameGroup: 2, end: 'brace' },
      { re: /^\s*interface\s+(\w+)/gm, kind: 'Interface', nameGroup: 1, end: 'brace' },
      { re: /^\s*enum\s+(\w+)/gm, kind: 'Enum', nameGroup: 1, end: 'brace' },
      { re: /^\s*(?:union|scalar)\s+(\w+)/gm, kind: 'Type', nameGroup: 1, end: 'line' },
    ],
  },
  proto: {
    exts: ['.proto'],
    lite: [
      { re: /^\s*message\s+(\w+)/gm, kind: 'Type', nameGroup: 1, end: 'brace' },
      { re: /^\s*enum\s+(\w+)/gm, kind: 'Enum', nameGroup: 1, end: 'brace' },
      { re: /^\s*service\s+(\w+)/gm, kind: 'Interface', nameGroup: 1, end: 'brace' },
    ],
  },
  r: {
    exts: ['.r', '.R'],
    lite: [{ re: /^\s*([A-Za-z_.][\w.]*)\s*(?:<-|=)\s*function\s*\(/gm, kind: 'Function', nameGroup: 1, end: 'brace' }],
  },
  markdown: { exts: ['.md', '.markdown'] },
};

const EXT_TO_LANG = new Map();
for (const [id, cfg] of Object.entries(LANGS)) {
  cfg.id = id;
  for (const ext of cfg.exts) EXT_TO_LANG.set(ext, id);
}

export function langForFile(filePath) {
  const m = /(\.[^./\\]+)$/.exec(filePath);
  if (!m) return null;
  const id = EXT_TO_LANG.get(m[1]) ?? EXT_TO_LANG.get(m[1].toLowerCase());
  return id ? LANGS[id] : null;
}

export const SUPPORTED_EXTENSIONS = [...EXT_TO_LANG.keys()];
