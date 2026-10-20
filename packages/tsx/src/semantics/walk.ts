import * as ts from '@typescript/typescript6';

import { SourceSpan } from '../diagnostics/diagnostic.model.ts';

/**
 * The kinds of node that hold no value syntax below them: names, literals, keywords that are values by
 * themselves, and statements made of nothing but a keyword or a label. Type-only declarations count too,
 * because nothing below them exists at runtime.
 */
const LEAF_KINDS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.Identifier,
    ts.SyntaxKind.PrivateIdentifier,
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NumericLiteral,
    ts.SyntaxKind.BigIntLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.RegularExpressionLiteral,
    ts.SyntaxKind.TrueKeyword,
    ts.SyntaxKind.FalseKeyword,
    ts.SyntaxKind.NullKeyword,
    ts.SyntaxKind.ThisKeyword,
    ts.SyntaxKind.SuperKeyword,
    ts.SyntaxKind.ImportKeyword,
    ts.SyntaxKind.MetaProperty,
    ts.SyntaxKind.OmittedExpression,
    ts.SyntaxKind.JsxText,
    ts.SyntaxKind.EmptyStatement,
    ts.SyntaxKind.DebuggerStatement,
    ts.SyntaxKind.BreakStatement,
    ts.SyntaxKind.ContinueStatement,
    ts.SyntaxKind.InterfaceDeclaration,
    ts.SyntaxKind.TypeAliasDeclaration
]);

/**
 * A visitor invoked for each node. Returning `false` skips that node's children.
 */
export type WalkVisitor = (node: ts.Node) => void | boolean;

/**
 * Depth-first walks the value-level syntax under a node, invoking the visitor for every node.
 *
 * Only what exists at runtime is visited. Type syntax is never entered, and a type-only wrapper
 * (`as`, `satisfies`, `<T>x`, `x!`) is looked through as if only its expression had been written. The
 * name of a non-computed member access, object property, method, attribute or tag is not visited
 * either, so an identifier the walk reports is always in value, reference or binding position - never a
 * property name.
 * @param node - The root node to walk.
 * @param visit - The visitor; return `false` to skip a node's children.
 * @param skip - Nodes to leave out entirely, together with everything below them.
 */
export function walk(node: ts.Node, visit: WalkVisitor, skip?: ReadonlySet<ts.Node>): void {
    if (skip?.has(node) === true || visit(node) === false) {
        return;
    }
    for (const child of childrenOf(node)) {
        walk(child, visit, skip);
    }
}

/**
 * An expression that only carries type information around the expression it wraps.
 */
type TypeSyntaxWrapper = ts.AsExpression
    | ts.SatisfiesExpression
    | ts.TypeAssertion
    | ts.NonNullExpression
    | ts.ExpressionWithTypeArguments;

/**
 * Whether a node only carries type information around the expression it wraps.
 * @param node - The node to test.
 * @returns True for `as`, `satisfies`, `<T>x`, `x!` and `f<T>`.
 */
function isTypeSyntaxWrapper(node: ts.Node): node is TypeSyntaxWrapper {
    return ts.isAsExpression(node)
        || ts.isSatisfiesExpression(node)
        || ts.isTypeAssertionExpression(node)
        || ts.isNonNullExpression(node)
        || ts.isExpressionWithTypeArguments(node);
}

/**
 * Looks through type-only wrappers to the expression that exists at runtime.
 * @param node - The expression.
 * @returns The expression under every `as`, `satisfies`, `<T>x`, `x!` and `f<T>` around it.
 */
export function unwrapTypeSyntax(node: ts.Expression): ts.Expression {
    let current: ts.Expression = node;
    while (isTypeSyntaxWrapper(current)) {
        current = current.expression;
    }
    return current;
}

/**
 * Returns the child nodes of a node that {@link walk} descends into, in evaluation order, each already
 * looked through its type-only wrappers.
 * @param node - The node whose children to enumerate.
 * @returns The child nodes.
 */
export function childrenOf(node: ts.Node): ts.Node[] {
    return rawChildrenOf(node).map(child => ts.isExpression(child) ? unwrapTypeSyntax(child) : child);
}

/**
 * The children of a node before type-only wrappers are looked through.
 * @param node - The node whose children to enumerate.
 * @returns The child nodes.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
function rawChildrenOf(node: ts.Node): ts.Node[] {
    if (ts.isVariableStatement(node)) {
        return declarationChildren(node.declarationList);
    }
    if (ts.isVariableDeclarationList(node)) {
        return declarationChildren(node);
    }
    if (ts.isVariableDeclaration(node)) {
        return compact([node.name, node.initializer]);
    }
    if (isFunctionLike(node)) {
        return compact([...decoratorExpressions(node), ...node.parameters, node.body]);
    }
    if (ts.isParameter(node)) {
        return compact([...decoratorExpressions(node), node.name, node.initializer]);
    }
    if (ts.isBindingElement(node)) {
        return compact([computedNameExpression(node.propertyName), node.name, node.initializer]);
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        return [
            ...decoratorExpressions(node),
            // `implements` names types only, `extends` evaluates its expression
            ...(node.heritageClauses ?? [])
                .filter(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)
                .flatMap(clause => [...clause.types]),
            ...node.members.flatMap(classMemberChildren)
        ];
    }
    if (ts.isEnumDeclaration(node)) {
        return node.members.flatMap(member => compact([computedNameExpression(member.name), member.initializer]));
    }
    if (ts.isObjectBindingPattern(node)) {
        // the rest binding of an object pattern is a name, not a pattern with parts of its own
        return node.elements.filter(element => element.dotDotDotToken == undefined);
    }
    if (ts.isArrayBindingPattern(node)) {
        return node.elements.filter(element => !ts.isOmittedExpression(element));
    }
    if (ts.isBlock(node)) {
        return [...node.statements];
    }
    if (ts.isExpressionStatement(node) || ts.isThrowStatement(node)) {
        return [node.expression];
    }
    if (ts.isReturnStatement(node)) {
        return compact([node.expression]);
    }
    if (ts.isIfStatement(node)) {
        return compact([node.expression, node.thenStatement, node.elseStatement]);
    }
    if (ts.isForStatement(node)) {
        return compact([node.initializer, node.condition, node.incrementor, node.statement]);
    }
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
        return [node.initializer, node.expression, node.statement];
    }
    if (ts.isWhileStatement(node)) {
        return [node.expression, node.statement];
    }
    if (ts.isDoStatement(node)) {
        return [node.statement, node.expression];
    }
    if (ts.isTryStatement(node)) {
        return compact([
            node.tryBlock,
            node.catchClause?.variableDeclaration?.name,
            node.catchClause?.block,
            node.finallyBlock
        ]);
    }
    if (ts.isSwitchStatement(node)) {
        return [
            node.expression,
            ...node.caseBlock.clauses.flatMap(clause => ts.isCaseClause(clause)
                ? [clause.expression, ...clause.statements]
                : [...clause.statements])
        ];
    }
    if (ts.isLabeledStatement(node)) {
        return [node.statement];
    }
    return expressionChildren(node);
}

/**
 * The children of the expression forms, and of JSX.
 * @param node - The node whose children to enumerate.
 * @returns The child nodes (empty for a leaf).
 * @throws {UnhandledSyntaxError} When the node is of a kind the walk has no case for.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
function expressionChildren(node: ts.Node): ts.Node[] {
    if (ts.isTemplateExpression(node)) {
        return node.templateSpans.map(span => span.expression);
    }
    if (ts.isTaggedTemplateExpression(node)) {
        return [node.tag, node.template];
    }
    if (ts.isArrayLiteralExpression(node)) {
        return node.elements.filter(element => !ts.isOmittedExpression(element));
    }
    if (ts.isObjectLiteralExpression(node)) {
        return node.properties.flatMap(objectMemberChildren);
    }
    if (ts.isSpreadElement(node) || ts.isParenthesizedExpression(node) || ts.isTypeOfExpression(node)
        || ts.isVoidExpression(node) || ts.isDeleteExpression(node) || ts.isAwaitExpression(node)) {
        return [node.expression];
    }
    if (ts.isYieldExpression(node)) {
        return compact([node.expression]);
    }
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
        return [node.operand];
    }
    if (ts.isBinaryExpression(node)) {
        return [node.left, node.right];
    }
    if (ts.isConditionalExpression(node)) {
        return [node.condition, node.whenTrue, node.whenFalse];
    }
    if (ts.isCallExpression(node)) {
        return [node.expression, ...node.arguments];
    }
    if (ts.isNewExpression(node)) {
        return [node.expression, ...node.arguments ?? []];
    }
    if (ts.isPropertyAccessExpression(node)) {
        return [node.expression];
    }
    if (ts.isElementAccessExpression(node)) {
        return [node.expression, node.argumentExpression];
    }
    if (ts.isJsxElement(node)) {
        return [...attributeExpressions(node.openingElement.attributes), ...node.children];
    }
    if (ts.isJsxSelfClosingElement(node)) {
        return attributeExpressions(node.attributes);
    }
    if (ts.isJsxFragment(node)) {
        return [...node.children];
    }
    if (ts.isJsxExpression(node)) {
        return compact([node.expression]);
    }
    if (isTypeSyntaxWrapper(node)) {
        return [node.expression];
    }
    if (LEAF_KINDS.has(node.kind)) {
        return [];
    }
    throw new UnhandledSyntaxError(node);
}

/**
 * The name of a syntax kind. TypeScript's enum also carries range markers (`FirstStatement`,
 * `LastStatement`, ...) under the same values, which are not names of any syntax.
 * @param kind - The syntax kind.
 * @returns Its name.
 */
function syntaxKindName(kind: ts.SyntaxKind): string {
    const names: string[] = Object.entries(ts.SyntaxKind)
        .filter(([name, value]) => value === kind && !/^(First|Last)[A-Z]/.test(name))
        .map(([name]) => name);
    return names[0] ?? ts.SyntaxKind[kind];
}

/**
 * Thrown when the walk meets syntax it has no case for. Skipping it would hide whatever the syntax holds
 * from every analysis built on the walk, so the walk refuses it instead.
 */
export class UnhandledSyntaxError extends Error {
    /**
     * The name of the syntax kind.
     */
    readonly kind: string;

    /**
     * Where the syntax is written.
     */
    readonly span: SourceSpan;

    /**
     * Creates the error for a node.
     * @param node - The node the walk has no case for.
     */
    constructor(node: ts.Node) {
        const kind: string = syntaxKindName(node.kind);
        super(`The compiler has no analysis for syntax of kind '${kind}'.`);
        this.name = 'UnhandledSyntaxError';
        this.kind = kind;
        this.span = { start: node.getStart(), end: node.getEnd() };
    }
}

/**
 * The children of one object literal member: a spread's argument, a computed key, and the value.
 * @param member - The member.
 * @returns The child nodes.
 * @throws {UnhandledSyntaxError} When the member is of a kind the walk has no case for.
 */
function objectMemberChildren(member: ts.ObjectLiteralElementLike): ts.Node[] {
    if (ts.isSpreadAssignment(member)) {
        return [member.expression];
    }
    if (ts.isShorthandPropertyAssignment(member)) {
        // `{ a }` reads the binding `a`, so the name is the value
        return [member.name];
    }
    if (ts.isPropertyAssignment(member)) {
        return ts.isComputedPropertyName(member.name)
            ? [member.name.expression, member.initializer]
            : [member.initializer];
    }
    if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
        // a shorthand method or an accessor is the function it declares; only a computed key is read
        return compact([computedNameExpression(member.name), member]);
    }
    throw new UnhandledSyntaxError(member);
}

/**
 * The children of one class member: a computed key, decorators, and the member's value - a field
 * initializer, the function a method, accessor or constructor declares, or a static block's body.
 * @param member - The member.
 * @returns The child nodes.
 * @throws {UnhandledSyntaxError} When the member is of a kind the walk has no case for.
 */
function classMemberChildren(member: ts.ClassElement): ts.Node[] {
    if (ts.isPropertyDeclaration(member)) {
        return compact([...decoratorExpressions(member), computedNameExpression(member.name), member.initializer]);
    }
    if (isFunctionLike(member)) {
        return compact([computedNameExpression(member.name), member]);
    }
    if (ts.isClassStaticBlockDeclaration(member)) {
        return [member.body];
    }
    if (ts.isIndexSignatureDeclaration(member) || ts.isSemicolonClassElement(member)) {
        return [];
    }
    throw new UnhandledSyntaxError(member);
}

/**
 * A function the walk enters: a declaration, an expression, an arrow, a method, an accessor or a
 * constructor.
 */
type FunctionLike = ts.FunctionDeclaration
    | ts.FunctionExpression
    | ts.ArrowFunction
    | ts.MethodDeclaration
    | ts.GetAccessorDeclaration
    | ts.SetAccessorDeclaration
    | ts.ConstructorDeclaration;

/**
 * Whether a node is a function the walk enters.
 * @param node - The node.
 * @returns True for every kind of {@link FunctionLike}.
 */
function isFunctionLike(node: ts.Node): node is FunctionLike {
    return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
        || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node);
}

/**
 * The expression of a computed key, which is read when the declaration is evaluated.
 * @param name - The key, if there is one.
 * @returns The expression, or undefined for a key that is written out.
 */
function computedNameExpression(name: ts.PropertyName | undefined): ts.Expression | undefined {
    return name != undefined && ts.isComputedPropertyName(name) ? name.expression : undefined;
}

/**
 * The expressions of the decorators on a node, which are read when the decorated declaration is evaluated.
 * @param node - The node.
 * @returns The decorator expressions.
 */
function decoratorExpressions(node: ts.Node): ts.Expression[] {
    return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []).map(decorator => decorator.expression) : [];
}

/**
 * The children of a variable declaration list: each declaration, which holds its binding followed by
 * its initializer.
 * @param list - The declaration list.
 * @returns The child nodes.
 */
function declarationChildren(list: ts.VariableDeclarationList): ts.Node[] {
    return [...list.declarations];
}

/**
 * The expressions embedded in JSX attributes: spread arguments, `={...}` values and JSX elements given
 * directly as values.
 * @param attributes - The attributes.
 * @returns The embedded expressions.
 */
function attributeExpressions(attributes: ts.JsxAttributes): ts.Node[] {
    const out: ts.Node[] = [];
    for (const attribute of attributes.properties) {
        const initializer: ts.JsxAttributeValue | undefined = ts.isJsxAttribute(attribute) ? attribute.initializer : undefined;
        if (ts.isJsxSpreadAttribute(attribute)) {
            out.push(attribute.expression);
        }
        else if (initializer != undefined && ts.isJsxExpression(initializer)) {
            out.push(...compact([initializer.expression]));
        }
        else if (initializer != undefined && !ts.isStringLiteral(initializer)) {
            out.push(initializer);
        }
    }
    return out;
}

/**
 * Filters out undefined entries from a list.
 * @param items - The items to compact.
 * @returns The defined items.
 */
function compact<T>(items: (T | undefined)[]): T[] {
    return items.filter((item): item is T => item !== undefined);
}