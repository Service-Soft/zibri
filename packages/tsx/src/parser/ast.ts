import { SourceSpan } from '../diagnostics/diagnostic.model';

/**
 * Common fields on every AST node.
 */
export type NodeBase = {
    /**
     * The source range this node spans.
     */
    span: SourceSpan
};

// ---------------------------------------------------------------------------
// Program & module items
// ---------------------------------------------------------------------------

/**
 * The root node of a parsed source file.
 */
export type Program = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'Program',
    /**
     * Top-level module items in source order.
     */
    body: ModuleItem[]
};

/**
 * A single named import binding.
 */
export type ImportSpecifier = {
    /**
     * The name exported by the module.
     */
    imported: string,
    /**
     * The local binding name.
     */
    local: string,
    /**
     * Whether this specifier was written as `type X` (type-only, erased).
     */
    typeOnly: boolean
};

/**
 * An `import` declaration. Type-only imports and `?client` sources are flagged for later phases.
 */
export type ImportDeclaration = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'ImportDeclaration',
    /**
     * The module specifier without quotes and without a trailing `?client` query.
     */
    source: string,
    /**
     * Whether the specifier carried a `?client` query (browser vendor bundle).
     */
    client: boolean,
    /**
     * Whether the whole declaration was `import type ...`.
     */
    typeOnly: boolean,
    /**
     * A default import binding name, if any.
     */
    defaultImport: string | undefined,
    /**
     * A namespace import binding name (`* as ns`), if any.
     */
    namespaceImport: string | undefined,
    /**
     * Named import specifiers.
     */
    specifiers: ImportSpecifier[]
};

/**
 * An `export` of a declaration, a default, or a name list.
 */
export type ExportDeclaration = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'ExportDeclaration',
    /**
     * Whether this is an `export default`.
     */
    default: boolean,
    /**
     * The exported declaration, if this export wraps one.
     */
    declaration: Statement | undefined,
    /**
     * The exported expression for `export default <expr>`.
     */
    expression: Expression | undefined
};

/**
 * Any top-level item.
 */
export type ModuleItem = ImportDeclaration | ExportDeclaration | Statement;

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

/**
 * The kind keyword of a variable declaration.
 */
export type VariableDeclarationKind = 'const' | 'let' | 'var';

/**
 * A single `name = init` (or pattern) binding in a variable declaration.
 */
export type VariableDeclarator = {
    /**
     * The bound pattern (identifier or destructuring pattern).
     */
    id: Pattern,
    /**
     * The initializer expression, if any.
     */
    init: Expression | undefined
};

/**
 * A `const`/`let`/`var` declaration.
 */
export type VariableDeclaration = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'VariableDeclaration',
    /**
     * The declaration keyword.
     */
    declarationKind: VariableDeclarationKind,
    /**
     * The declared bindings.
     */
    declarations: VariableDeclarator[]
};

/**
 * A `function` declaration.
 */
export type FunctionDeclaration = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'FunctionDeclaration',
    /**
     * The function name.
     */
    id: string,
    /**
     * Whether the function is async.
     */
    async: boolean,
    /**
     * Whether the function is a generator.
     */
    generator: boolean,
    /**
     * The parameter patterns.
     */
    params: Pattern[],
    /**
     * The function body.
     */
    body: BlockStatement
};

/**
 * A `{ ... }` block statement.
 */
export type BlockStatement = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'BlockStatement',
    /**
     * The contained statements.
     */
    body: Statement[]
};

/**
 * An expression used in statement position.
 */
export type ExpressionStatement = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'ExpressionStatement',
    /**
     * The expression.
     */
    expression: Expression
};

/**
 * A `return` statement.
 */
export type ReturnStatement = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'ReturnStatement',
    /**
     * The returned expression, if any.
     */
    argument: Expression | undefined
};

/**
 * An `if`/`else` statement.
 */
export type IfStatement = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'IfStatement',
    /**
     * The condition.
     */
    test: Expression,
    /**
     * The branch taken when the condition is truthy.
     */
    consequent: Statement,
    /**
     * The else branch, if any.
     */
    alternate: Statement | undefined
};

/**
 * A C-style `for` statement.
 */
export type ForStatement = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'ForStatement',
    /**
     * The initializer (a declaration or expression), if any.
     */
    init: VariableDeclaration | Expression | undefined,
    /**
     * The loop condition, if any.
     */
    test: Expression | undefined,
    /**
     * The update expression, if any.
     */
    update: Expression | undefined,
    /**
     * The loop body.
     */
    body: Statement
};

/**
 * A `for...of` statement.
 */
export type ForOfStatement = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'ForOfStatement',
    /**
     * The binding target.
     */
    left: VariableDeclaration | Pattern,
    /**
     * The iterated expression.
     */
    right: Expression,
    /**
     * The loop body.
     */
    body: Statement
};

/**
 * A `while` statement.
 */
export type WhileStatement = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'WhileStatement',
    /**
     * The loop condition.
     */
    test: Expression,
    /**
     * The loop body.
     */
    body: Statement
};

/**
 * A `break` statement, optionally targeting a label.
 */
export type BreakStatement = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'BreakStatement',
    /**
     * The target label, if any.
     */
    label: string | undefined
};

/**
 * A `continue` statement, optionally targeting a label.
 */
export type ContinueStatement = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'ContinueStatement',
    /**
     * The target label, if any.
     */
    label: string | undefined
};

/**
 * A `throw` statement.
 */
export type ThrowStatement = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'ThrowStatement',
    /**
     * The thrown expression.
     */
    argument: Expression
};

/**
 * A `try`/`catch`/`finally` statement.
 */
export type TryStatement = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'TryStatement',
    /**
     * The guarded block.
     */
    block: BlockStatement,
    /**
     * The catch parameter pattern, if any.
     */
    handlerParam: Pattern | undefined,
    /**
     * The catch block, if any.
     */
    handlerBody: BlockStatement | undefined,
    /**
     * The finally block, if any.
     */
    finalizer: BlockStatement | undefined
};

/**
 * A single `case`/`default` clause of a switch statement.
 */
export type SwitchCase = {
    /**
     * The case test expression, or undefined for the `default` clause.
     */
    test: Expression | undefined,
    /**
     * The statements of this clause.
     */
    consequent: Statement[]
};

/**
 * A `switch` statement.
 */
export type SwitchStatement = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'SwitchStatement',
    /**
     * The value being switched on.
     */
    discriminant: Expression,
    /**
     * The case clauses in order.
     */
    cases: SwitchCase[]
};

/**
 * An empty `;` statement.
 */
export type EmptyStatement = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'EmptyStatement'
};

/**
 * A `label: statement` labeled statement.
 */
export type LabeledStatement = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'LabeledStatement',
    /**
     * The label name.
     */
    label: string,
    /**
     * The labeled statement body.
     */
    body: Statement
};

/**
 * Any statement.
 */
export type Statement
    = | VariableDeclaration
        | FunctionDeclaration
        | BlockStatement
        | ExpressionStatement
        | ReturnStatement
        | IfStatement
        | ForStatement
        | ForOfStatement
        | WhileStatement
        | BreakStatement
        | ContinueStatement
        | ThrowStatement
        | TryStatement
        | SwitchStatement
        | EmptyStatement
        | LabeledStatement;

// ---------------------------------------------------------------------------
// Patterns (binding targets)
// ---------------------------------------------------------------------------

/**
 * A property inside an object destructuring pattern.
 */
export type ObjectPatternProperty = {
    /**
     * The source property key.
     */
    key: string,
    /**
     * Whether the key was written as a computed `[expr]`.
     */
    computed: boolean,
    /**
     * The bound value pattern. An {@link AssignmentPattern} carries any default value.
     */
    value: Pattern,
    /**
     * Whether written in shorthand form (`{ a }` rather than `{ a: b }`).
     */
    shorthand: boolean
};

/**
 * An object destructuring pattern.
 */
export type ObjectPattern = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'ObjectPattern',
    /**
     * The destructured properties.
     */
    properties: ObjectPatternProperty[],
    /**
     * A `...rest` binding name, if any.
     */
    rest: string | undefined
};

/**
 * An array destructuring pattern.
 */
export type ArrayPattern = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'ArrayPattern',
    /**
     * The destructured elements (null represents an elision/hole). An
     * {@link AssignmentPattern} element carries any default value.
     */
    elements: (Pattern | null)[],
    /**
     * A `...rest` binding pattern, if any.
     */
    rest: Pattern | undefined
};

/**
 * An identifier used as a binding target.
 */
export type IdentifierPattern = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'IdentifierPattern',
    /**
     * The bound name.
     */
    name: string
};

/**
 * A rest parameter, e.g. `...args` in `function f(...args)`. Distinct from an array pattern's rest
 * slot: this gathers the remaining arguments rather than destructuring one of them.
 */
export type RestElement = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'RestElement',
    /**
     * The bound pattern that receives the gathered values.
     */
    argument: Pattern
};

/**
 * A binding target with a default value, e.g. `a = 5` in a parameter or destructuring slot.
 */
export type AssignmentPattern = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'AssignmentPattern',
    /**
     * The underlying binding target.
     */
    left: Pattern,
    /**
     * The default value expression.
     */
    right: Expression
};

/**
 * Any binding pattern.
 */
export type Pattern = IdentifierPattern | ObjectPattern | ArrayPattern | AssignmentPattern | RestElement;

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

/**
 * An identifier reference.
 */
export type Identifier = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'Identifier',
    /**
     * The identifier name.
     */
    name: string
};

/**
 * A numeric literal.
 */
export type NumericLiteral = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'NumericLiteral',
    /**
     * The raw source text of the number.
     */
    raw: string
};

/**
 * A string literal.
 */
export type StringLiteral = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'StringLiteral',
    /**
     * The raw source text including quotes.
     */
    raw: string,
    /**
     * The decoded string value.
     */
    value: string
};

/**
 * A boolean literal.
 */
export type BooleanLiteral = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'BooleanLiteral',
    /**
     * The boolean value.
     */
    value: boolean
};

/**
 * A `null` literal.
 */
export type NullLiteral = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'NullLiteral'
};

/**
 * A regular expression literal.
 */
export type RegexLiteral = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'RegexLiteral',
    /**
     * The raw source text including slashes and flags.
     */
    raw: string
};

/**
 * A template literal, split into static quasis and interpolated expressions.
 */
export type TemplateLiteral = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'TemplateLiteral',
    /**
     * The static string segments (raw, without delimiters). Length is expressions.length + 1.
     */
    quasis: string[],
    /**
     * The interpolated expressions.
     */
    expressions: Expression[]
};

/**
 * A tagged template expression, e.g. `$t\`...\``.
 */
export type TaggedTemplateExpression = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'TaggedTemplateExpression',
    /**
     * The tag expression.
     */
    tag: Expression,
    /**
     * The template literal.
     */
    quasi: TemplateLiteral
};

/**
 * A `this` reference.
 */
export type ThisExpression = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'ThisExpression'
};

/**
 * An element of an array literal, or a hole.
 */
export type ArrayElement = Expression | SpreadElement;

/**
 * An array literal.
 */
export type ArrayExpression = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'ArrayExpression',
    /**
     * The elements (null represents an elision/hole).
     */
    elements: (ArrayElement | null)[]
};

/**
 * A property of an object literal.
 */
export type ObjectProperty = {
    /**
     * Discriminant.
     */
    kind: 'ObjectProperty',
    /**
     * The property key expression or name.
     */
    key: Expression,
    /**
     * Whether the key is computed (`[expr]`).
     */
    computed: boolean,
    /**
     * Whether written in shorthand form.
     */
    shorthand: boolean,
    /**
     * The property value.
     */
    value: Expression
};

/**
 * An object literal member.
 */
export type ObjectMember = ObjectProperty | SpreadElement;

/**
 * An object literal.
 */
export type ObjectExpression = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'ObjectExpression',
    /**
     * The members.
     */
    properties: ObjectMember[]
};

/**
 * A `...expr` spread element.
 */
export type SpreadElement = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'SpreadElement',
    /**
     * The spread argument.
     */
    argument: Expression
};

/**
 * An arrow function expression.
 */
export type ArrowFunctionExpression = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'ArrowFunctionExpression',
    /**
     * Whether the arrow is async.
     */
    async: boolean,
    /**
     * The parameter patterns.
     */
    params: Pattern[],
    /**
     * The body: a block statement or a concise expression body.
     */
    body: BlockStatement | Expression
};

/**
 * A `function` expression.
 */
export type FunctionExpression = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'FunctionExpression',
    /**
     * The optional name.
     */
    id: string | undefined,
    /**
     * Whether the function is async.
     */
    async: boolean,
    /**
     * Whether the function is a generator.
     */
    generator: boolean,
    /**
     * The parameter patterns.
     */
    params: Pattern[],
    /**
     * The function body.
     */
    body: BlockStatement
};

/**
 * A prefix unary expression (`!`, `-`, `typeof`, `void`, `delete`, `await`).
 */
export type UnaryExpression = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'UnaryExpression',
    /**
     * The operator.
     */
    operator: string,
    /**
     * The operand.
     */
    argument: Expression
};

/**
 * A `++`/`--` update expression.
 */
export type UpdateExpression = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'UpdateExpression',
    /**
     * The operator.
     */
    operator: string,
    /**
     * Whether the operator is prefix.
     */
    prefix: boolean,
    /**
     * The operand.
     */
    argument: Expression
};

/**
 * A binary expression (arithmetic/comparison/bitwise).
 */
export type BinaryExpression = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'BinaryExpression',
    /**
     * The operator.
     */
    operator: string,
    /**
     * The left operand.
     */
    left: Expression,
    /**
     * The right operand.
     */
    right: Expression
};

/**
 * A logical expression (`&&`, `||`, `??`).
 */
export type LogicalExpression = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'LogicalExpression',
    /**
     * The operator.
     */
    operator: string,
    /**
     * The left operand.
     */
    left: Expression,
    /**
     * The right operand.
     */
    right: Expression
};

/**
 * An assignment expression.
 */
export type AssignmentExpression = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'AssignmentExpression',
    /**
     * The assignment operator.
     */
    operator: string,
    /**
     * The assignment target.
     */
    left: Expression,
    /**
     * The assigned value.
     */
    right: Expression
};

/**
 * A conditional (ternary) expression.
 */
export type ConditionalExpression = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'ConditionalExpression',
    /**
     * The condition.
     */
    test: Expression,
    /**
     * The value when truthy.
     */
    consequent: Expression,
    /**
     * The value when falsy.
     */
    alternate: Expression
};

/**
 * A call expression.
 */
export type CallExpression = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'CallExpression',
    /**
     * The callee.
     */
    callee: Expression,
    /**
     * The call arguments.
     */
    arguments: (Expression | SpreadElement)[],
    /**
     * Whether the call used optional chaining (`?.()`).
     */
    optional: boolean
};

/**
 * A `new` expression.
 */
export type NewExpression = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'NewExpression',
    /**
     * The constructor callee.
     */
    callee: Expression,
    /**
     * The constructor arguments.
     */
    arguments: (Expression | SpreadElement)[]
};

/**
 * A member access expression.
 */
export type MemberExpression = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'MemberExpression',
    /**
     * The object being accessed.
     */
    object: Expression,
    /**
     * The property (an Identifier when not computed, any expression when computed).
     */
    property: Expression,
    /**
     * Whether the access is computed (`a[b]`).
     */
    computed: boolean,
    /**
     * Whether the access used optional chaining (`a?.b`).
     */
    optional: boolean
};

/**
 * A parenthesized expression, kept to preserve grouping for faithful re-emission.
 */
export type ParenthesizedExpression = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'ParenthesizedExpression',
    /**
     * The inner expression.
     */
    expression: Expression
};

/**
 * A comma sequence expression.
 */
export type SequenceExpression = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'SequenceExpression',
    /**
     * The sub-expressions in order.
     */
    expressions: Expression[]
};

// ---------------------------------------------------------------------------
// JSX
// ---------------------------------------------------------------------------

/**
 * A simple JSX tag name, e.g. `div` or `Button`.
 */
export type JSXIdentifier = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'JSXIdentifier',
    /**
     * The name.
     */
    name: string
};

/**
 * A member JSX tag name, e.g. `Namespace.Component`.
 */
export type JSXMemberName = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'JSXMemberName',
    /**
     * The object part.
     */
    object: JSXIdentifier | JSXMemberName,
    /**
     * The property part.
     */
    property: string
};

/**
 * A JSX tag name.
 */
export type JSXName = JSXIdentifier | JSXMemberName;

/**
 * A `{expression}` container in JSX (attribute value or child).
 */
export type JSXExpressionContainer = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'JSXExpressionContainer',
    /**
     * The contained expression, or undefined for an empty `{}` (e.g. A comment-only container).
     */
    expression: Expression | undefined
};

/**
 * A JSX attribute.
 */
export type JSXAttribute = {
    /**
     * Discriminant.
     */
    kind: 'JSXAttribute',
    /**
     * The attribute name (may contain `-` or `:`).
     */
    name: string,
    /**
     * The attribute value: a string literal, an expression container, or undefined (boolean true).
     */
    value: StringLiteral | JSXExpressionContainer | undefined,
    /**
     * The source span.
     */
    span: SourceSpan
};

/**
 * A `{...expr}` spread attribute.
 */
export type JSXSpreadAttribute = {
    /**
     * Discriminant.
     */
    kind: 'JSXSpreadAttribute',
    /**
     * The spread argument.
     */
    argument: Expression,
    /**
     * The source span.
     */
    span: SourceSpan
};

/**
 * Raw text between JSX tags.
 */
export type JSXText = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'JSXText',
    /**
     * The raw text value.
     */
    value: string
};

/**
 * A JSX element with an opening tag, children, and optional closing tag.
 */
export type JSXElement = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'JSXElement',
    /**
     * The tag name.
     */
    name: JSXName,
    /**
     * The attributes and spread attributes.
     */
    attributes: (JSXAttribute | JSXSpreadAttribute)[],
    /**
     * Whether the element is self-closing.
     */
    selfClosing: boolean,
    /**
     * The child nodes.
     */
    children: JSXChild[]
};

/**
 * A `<>...</>` fragment.
 */
export type JSXFragment = NodeBase & {
    /**
     * Discriminant.
     */
    kind: 'JSXFragment',
    /**
     * The child nodes.
     */
    children: JSXChild[]
};

/**
 * Any JSX child node.
 */
export type JSXChild = JSXText | JSXElement | JSXFragment | JSXExpressionContainer;

/**
 * Any expression node.
 */
export type Expression
    = | Identifier
        | NumericLiteral
        | StringLiteral
        | BooleanLiteral
        | NullLiteral
        | RegexLiteral
        | TemplateLiteral
        | TaggedTemplateExpression
        | ThisExpression
        | ArrayExpression
        | ObjectExpression
        | ArrowFunctionExpression
        | FunctionExpression
        | UnaryExpression
        | UpdateExpression
        | BinaryExpression
        | LogicalExpression
        | AssignmentExpression
        | ConditionalExpression
        | CallExpression
        | NewExpression
        | MemberExpression
        | ParenthesizedExpression
        | SequenceExpression
        | SpreadElement
        | JSXElement
        | JSXFragment;

/**
 * Any AST node with a discriminant `kind`.
 */
export type Node = Program | ModuleItem | Statement | Expression | Pattern | JSXChild;