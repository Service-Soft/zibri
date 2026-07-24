import { ComponentFunction } from './component';
import { walk, WalkNode } from './walk';
import { Pattern } from '../parser/ast';

/**
 * Collects the identifier names bound by a single binding pattern (including nested destructuring,
 * defaults, and rest elements).
 * @param pattern - The pattern to inspect.
 * @returns The bound names in source order.
 */
export function collectPatternNames(pattern: Pattern): string[] {
    const names: string[] = [];
    walk(pattern, node => {
        if (node.kind === 'IdentifierPattern') {
            names.push(node.name);
        }
        else if (node.kind === 'ObjectPattern' && node.rest) {
            names.push(node.rest);
        }
    });
    return names;
}

/**
 * Walks a function's parameters and body, invoking the visitor on every contained node.
 * @param fn - The function to walk.
 * @param visit - The visitor.
 */
function walkFunction(fn: ComponentFunction, visit: (node: WalkNode) => void): void {
    for (const param of fn.params) {
        walk(param, node => {
            visit(node);
        });
    }
    walk(fn.body, node => {
        visit(node);
    });
}

/**
 * Collects every identifier bound anywhere within a function — its parameters, local
 * declarations, and the parameters and declarations of any nested functions. This is the set of
 * names that a per-instance rename must cover so that repeated component instances do not collide.
 * @param fn - The function to analyze.
 * @returns The set of all locally bound names.
 */
export function collectFunctionBindings(fn: ComponentFunction): Set<string> {
    const bound: Set<string> = new Set<string>();
    walkFunction(fn, node => {
        switch (node.kind) {
            case 'IdentifierPattern': {
                bound.add(node.name);
                break;
            }
            case 'ObjectPattern': {
                if (node.rest) {
                    bound.add(node.rest);
                }
                break;
            }
            case 'FunctionDeclaration': {
                bound.add(node.id);
                break;
            }
            case 'FunctionExpression': {
                if (node.id) {
                    bound.add(node.id);
                }
                break;
            }
            case 'VariableDeclaration':
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
            case 'ArrayPattern':
            case 'AssignmentPattern':
            case 'RestElement':
            case 'JSXText':
            case 'JSXExpressionContainer': {
                break;
            }
        }
    });
    return bound;
}

/**
 * Collects the names of every identifier referenced (in value/reference position) within a node.
 * Property names of non-computed member accesses and object keys are not included.
 * @param node - The node to analyze.
 * @returns The set of referenced identifier names.
 */
export function collectReferencedIdentifiers(node: WalkNode): Set<string> {
    const referenced: Set<string> = new Set<string>();
    walk(node, current => {
        if (current.kind === 'Identifier') {
            referenced.add(current.name);
        }
    });
    return referenced;
}

/**
 * Collects the free identifiers of a function: names referenced in its parameters or body that are
 * not bound locally (imports, globals, props passed as a bare parameter, and outer-scope closures).
 * @param fn - The function to analyze.
 * @returns The set of free identifier names.
 */
export function collectFreeIdentifiers(fn: ComponentFunction): Set<string> {
    const bound: Set<string> = collectFunctionBindings(fn);
    const free: Set<string> = new Set<string>();
    walkFunction(fn, node => {
        if (node.kind === 'Identifier' && !bound.has(node.name)) {
            free.add(node.name);
        }
    });
    return free;
}