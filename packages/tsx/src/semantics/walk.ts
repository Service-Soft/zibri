import { Expression, JSXAttribute, JSXChild, JSXSpreadAttribute, ObjectProperty, Pattern, Statement } from '../parser/ast';

/**
 * A node kind that {@link walk} descends through and reports.
 */
export type WalkNode = Statement | Expression | Pattern | JSXChild;

/**
 * A visitor invoked for each node. Returning `false` skips that node's children.
 */
export type WalkVisitor = (node: WalkNode) => void | boolean;

/**
 * Depth-first walks a statement/expression/pattern subtree, invoking the visitor for every node.
 *
 * The property of a non-computed member access and the key of a non-computed object property are
 * intentionally NOT visited, so identifiers reported by the walk are only those in value/reference
 * or binding position — never property names.
 * @param node - The root node to walk.
 * @param visit - The visitor; return `false` to skip a node's children.
 */
export function walk(node: WalkNode, visit: WalkVisitor): void {
    if (visit(node) === false) {
        return;
    }
    for (const child of childrenOf(node)) {
        walk(child, visit);
    }
}

/**
 * Returns the child nodes of a node that {@link walk} should descend into.
 * @param node - The node whose children to enumerate.
 * @returns The child nodes in evaluation order.
 */
export function childrenOf(node: WalkNode): WalkNode[] {
    return statementChildren(node)
        ?? expressionChildren(node)
        ?? patternOrJsxChildren(node)
        ?? [];
}

/**
 * Enumerates the children of statement nodes, or undefined when the node is not a statement.
 * @param node - The node to inspect.
 * @returns The child nodes, or undefined.
 */
function statementChildren(node: WalkNode): WalkNode[] | undefined {
    switch (node.kind) {
        case 'VariableDeclaration': {
            return node.declarations.flatMap(d => d.init ? [d.id, d.init] : [d.id]);
        }
        case 'FunctionDeclaration': {
            return [...node.params, node.body];
        }
        case 'BlockStatement': {
            return node.body;
        }
        case 'ExpressionStatement': {
            return [node.expression];
        }
        case 'ReturnStatement': {
            return node.argument ? [node.argument] : [];
        }
        case 'ThrowStatement': {
            return [node.argument];
        }
        case 'IfStatement': {
            return compact([node.test, node.consequent, node.alternate]);
        }
        case 'ForStatement': {
            return compact([node.init, node.test, node.update, node.body]);
        }
        case 'ForOfStatement': {
            return [node.left, node.right, node.body];
        }
        case 'WhileStatement': {
            return [node.test, node.body];
        }
        case 'TryStatement': {
            return compact([node.block, node.handlerParam, node.handlerBody, node.finalizer]);
        }
        case 'SwitchStatement': {
            return [node.discriminant, ...node.cases.flatMap(c => compact([c.test, ...c.consequent]))];
        }
        case 'LabeledStatement': {
            return [node.body];
        }
        case 'BreakStatement':
        case 'ContinueStatement':
        case 'EmptyStatement':
        case 'Identifier':
        case 'NumericLiteral':
        case 'StringLiteral':
        case 'BooleanLiteral':
        case 'NullLiteral':
        case 'RegexLiteral':
        case 'TemplateLiteral':
        case 'TaggedTemplateExpression':
        case 'ThisExpression':
        case 'ArrayExpression':
        case 'ObjectExpression':
        case 'ArrowFunctionExpression':
        case 'FunctionExpression':
        case 'UnaryExpression':
        case 'UpdateExpression':
        case 'BinaryExpression':
        case 'LogicalExpression':
        case 'AssignmentExpression':
        case 'ConditionalExpression':
        case 'CallExpression':
        case 'NewExpression':
        case 'MemberExpression':
        case 'ParenthesizedExpression':
        case 'SequenceExpression':
        case 'SpreadElement':
        case 'JSXElement':
        case 'JSXFragment':
        case 'IdentifierPattern':
        case 'ObjectPattern':
        case 'ArrayPattern':
        case 'AssignmentPattern':
        case 'RestElement':
        case 'JSXText':
        case 'JSXExpressionContainer':
        default: {
            return undefined;
        }
    }
}

/**
 * Enumerates the children of expression nodes, or undefined when the node is not an expression.
 * @param node - The node to inspect.
 * @returns The child nodes, or undefined.
 */
function expressionChildren(node: WalkNode): WalkNode[] | undefined {
    switch (node.kind) {
        case 'FunctionExpression':
        case 'ArrowFunctionExpression': {
            return [...node.params, node.body];
        }
        case 'TemplateLiteral': {
            return node.expressions;
        }
        case 'TaggedTemplateExpression': {
            return [node.tag, node.quasi];
        }
        case 'ArrayExpression': {
            return compact(node.elements);
        }
        case 'ObjectExpression': {
            return node.properties.flatMap(p => p.kind === 'SpreadElement' ? [p.argument] : objectPropertyChildren(p));
        }
        case 'SpreadElement': {
            return [node.argument];
        }
        case 'UnaryExpression':
        case 'UpdateExpression': {
            return [node.argument];
        }
        case 'BinaryExpression':
        case 'LogicalExpression':
        case 'AssignmentExpression': {
            return [node.left, node.right];
        }
        case 'ConditionalExpression': {
            return [node.test, node.consequent, node.alternate];
        }
        case 'CallExpression':
        case 'NewExpression': {
            return [node.callee, ...node.arguments];
        }
        case 'MemberExpression': {
            return node.computed ? [node.object, node.property] : [node.object];
        }
        case 'ParenthesizedExpression': {
            return [node.expression];
        }
        case 'SequenceExpression': {
            return node.expressions;
        }
        case 'VariableDeclaration':
        case 'FunctionDeclaration':
        case 'BlockStatement':
        case 'ExpressionStatement':
        case 'ReturnStatement':
        case 'IfStatement':
        case 'ForStatement':
        case 'ForOfStatement':
        case 'WhileStatement':
        case 'BreakStatement':
        case 'ContinueStatement':
        case 'ThrowStatement':
        case 'TryStatement':
        case 'SwitchStatement':
        case 'EmptyStatement':
        case 'LabeledStatement':
        case 'Identifier':
        case 'NumericLiteral':
        case 'StringLiteral':
        case 'BooleanLiteral':
        case 'NullLiteral':
        case 'RegexLiteral':
        case 'ThisExpression':
        case 'JSXElement':
        case 'JSXFragment':
        case 'IdentifierPattern':
        case 'ObjectPattern':
        case 'ArrayPattern':
        case 'AssignmentPattern':
        case 'RestElement':
        case 'JSXText':
        case 'JSXExpressionContainer':
        default: {
            return undefined;
        }
    }
}

/**
 * Enumerates the children of pattern and JSX nodes, or undefined for leaf/other nodes.
 * @param node - The node to inspect.
 * @returns The child nodes, or undefined.
 */
function patternOrJsxChildren(node: WalkNode): WalkNode[] | undefined {
    switch (node.kind) {
        case 'ObjectPattern': {
            return node.properties.map(p => p.value);
        }
        case 'ArrayPattern': {
            return compact([...node.elements, node.rest]);
        }
        case 'AssignmentPattern': {
            return [node.left, node.right];
        }
        case 'RestElement': {
            return [node.argument];
        }
        case 'JSXElement': {
            return [...jsxAttributeChildren(node.attributes), ...node.children];
        }
        case 'JSXFragment': {
            return node.children;
        }
        case 'JSXExpressionContainer': {
            return node.expression ? [node.expression] : [];
        }
        case 'VariableDeclaration':
        case 'FunctionDeclaration':
        case 'BlockStatement':
        case 'ExpressionStatement':
        case 'ReturnStatement':
        case 'IfStatement':
        case 'ForStatement':
        case 'ForOfStatement':
        case 'WhileStatement':
        case 'BreakStatement':
        case 'ContinueStatement':
        case 'ThrowStatement':
        case 'TryStatement':
        case 'SwitchStatement':
        case 'EmptyStatement':
        case 'LabeledStatement':
        case 'Identifier':
        case 'NumericLiteral':
        case 'StringLiteral':
        case 'BooleanLiteral':
        case 'NullLiteral':
        case 'RegexLiteral':
        case 'TemplateLiteral':
        case 'TaggedTemplateExpression':
        case 'ThisExpression':
        case 'ArrayExpression':
        case 'ObjectExpression':
        case 'ArrowFunctionExpression':
        case 'FunctionExpression':
        case 'UnaryExpression':
        case 'UpdateExpression':
        case 'BinaryExpression':
        case 'LogicalExpression':
        case 'AssignmentExpression':
        case 'ConditionalExpression':
        case 'CallExpression':
        case 'NewExpression':
        case 'MemberExpression':
        case 'ParenthesizedExpression':
        case 'SequenceExpression':
        case 'SpreadElement':
        case 'IdentifierPattern':
        case 'JSXText':
        default: {
            return undefined;
        }
    }
}

/**
 * Enumerates the child expressions of an object-literal property.
 * @param property - The property to inspect.
 * @returns The key (only when computed) and the value.
 */
function objectPropertyChildren(property: ObjectProperty): Expression[] {
    return property.computed ? [property.key, property.value] : [property.value];
}

/**
 * Enumerates the embedded expressions of JSX attributes (spread arguments and `={...}` values).
 * @param attributes - The attributes to inspect.
 * @returns The embedded expression nodes.
 */
function jsxAttributeChildren(attributes: (JSXAttribute | JSXSpreadAttribute)[]): WalkNode[] {
    const out: WalkNode[] = [];
    for (const attr of attributes) {
        if (attr.kind === 'JSXSpreadAttribute') {
            out.push(attr.argument);
        }
        else if (attr.value?.kind === 'JSXExpressionContainer' && attr.value.expression) {
            out.push(attr.value.expression);
        }
    }
    return out;
}

/**
 * Filters out null/undefined entries from a list.
 * @param items - The items to compact.
 * @returns The non-nullish items.
 */
function compact<T>(items: (T | null | undefined)[]): T[] {
    return items.filter((item): item is T => item != undefined);
}