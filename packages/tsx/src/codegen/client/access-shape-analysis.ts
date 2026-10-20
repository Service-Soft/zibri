import * as ts from '@typescript/typescript6';

import { AccessShape } from '../../runtime/access-shape.ts';
import { isBindingIdentifier } from '../../semantics/binding.ts';
import { symbolOf } from '../../semantics/symbols.ts';
import { walk } from '../../semantics/walk.ts';

/**
 * Array methods whose callback receives each element as its first parameter.
 */
const ELEMENT_CALLBACK_METHODS: ReadonlySet<string> = new Set([
    'map',
    'forEach',
    'filter',
    'some',
    'every',
    'find',
    'findIndex',
    'findLast',
    'findLastIndex',
    'flatMap'
]);

/**
 * Array methods whose callback receives each element as its second parameter.
 */
const ACCUMULATOR_CALLBACK_METHODS: ReadonlySet<string> = new Set(['reduce', 'reduceRight']);

/**
 * Array methods whose callback compares two elements.
 */
const COMPARATOR_METHODS: ReadonlySet<string> = new Set(['sort', 'toSorted']);

/**
 * Array methods that return one of the elements.
 */
const ELEMENT_RETURNING_METHODS: ReadonlySet<string> = new Set(['at', 'find', 'findLast']);

/**
 * Array methods that return the elements of the array, in any order or number.
 */
const ELEMENTS_RETURNING_METHODS: ReadonlySet<string> = new Set(['filter', 'slice', 'sort', 'toSorted', 'reverse', 'toReversed']);

/**
 * What is read from a value, collected while its uses are classified.
 */
type ShapeBuilder = {
    /**
     * Whether the value is used whole.
     */
    whole: boolean,
    /**
     * The fields read.
     */
    fields: Map<string, ShapeBuilder>,
    /**
     * What is read from the elements, when any element is read.
     */
    items: ShapeBuilder | undefined
};

/**
 * Works out what client code reads from a variable: the fields it reads, through aliases, destructuring,
 * loops and array callbacks, or the variable whole wherever client code uses it any other way.
 * @param variable - The variable: a prop or a captured loop value.
 * @param nodes - The client code.
 * @param omitted - What inside the client code is left out.
 * @returns What is read from the variable.
 */
export function accessShapeOf(variable: ts.Symbol, nodes: readonly ts.Node[], omitted: ReadonlySet<ts.Node> = new Set()): AccessShape {
    const references: Map<ts.Symbol, ts.Identifier[]> = new Map<ts.Symbol, ts.Identifier[]>();
    for (const node of nodes) {
        walk(node, current => {
            if (!ts.isIdentifier(current) || isBindingIdentifier(current)) {
                return;
            }
            const symbol: ts.Symbol | undefined = symbolOf(current);
            if (symbol !== undefined) {
                references.set(symbol, [...references.get(symbol) ?? [], current]);
            }
        }, omitted);
    }
    const root: ShapeBuilder = emptyBuilder();
    new AccessCollector(references).bindVariable(variable, root);
    return shapeOf(root);
}

/**
 * Classifies every use of a variable and of the variables it flows into.
 */
class AccessCollector {
    /**
     * The variables already followed, each with the builders it was followed into.
     */
    private readonly followed: Map<ts.Symbol, Set<ShapeBuilder>> = new Map<ts.Symbol, Set<ShapeBuilder>>();

    /**
     * Creates a collector over the references client code makes.
     * @param references - The identifiers reading each variable.
     */
    constructor(private readonly references: ReadonlyMap<ts.Symbol, ts.Identifier[]>) {}

    /**
     * Records what is read from a variable into a builder.
     * @param variable - The variable.
     * @param builder - What is read from the value it holds.
     */
    bindVariable(variable: ts.Symbol, builder: ShapeBuilder): void {
        const builders: Set<ShapeBuilder> = this.followed.get(variable) ?? new Set<ShapeBuilder>();
        if (builders.has(builder)) {
            return;
        }
        builders.add(builder);
        this.followed.set(variable, builders);
        for (const reference of this.references.get(variable) ?? []) {
            this.classify(reference, builder);
        }
    }

    /**
     * Records what a use of a value reads from it.
     * @param expression - An expression evaluating to the value.
     * @param builder - What is read from the value.
     */
    private classify(expression: ts.Expression, builder: ShapeBuilder): void {
        const node: ts.Expression = outermostWrapper(expression);
        const parent: ts.Node = node.parent;
        if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
            this.member(parent, builder);
            return;
        }
        if (ts.isElementAccessExpression(parent) && parent.expression === node) {
            const key: ts.Expression = parent.argumentExpression;
            this.classify(parent, ts.isStringLiteralLike(key) ? fieldOf(builder, key.text) : itemsOf(builder));
            return;
        }
        if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
            this.bindName(parent.name, builder);
            return;
        }
        if (ts.isForOfStatement(parent) && parent.expression === node) {
            this.bindLoopVariable(parent.initializer, itemsOf(builder));
            return;
        }
        if (isOnlyTested(node, parent)) {
            return;
        }
        if (isPassedThrough(node, parent)) {
            this.classify(parent, builder);
            return;
        }
        if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.left === node) {
            // overwritten, not read
            return;
        }
        builder.whole = true;
    }

    /**
     * Records a member read or a method call on a value.
     * @param access - The member access.
     * @param builder - What is read from the value.
     */
    private member(access: ts.PropertyAccessExpression, builder: ShapeBuilder): void {
        const node: ts.Expression = outermostWrapper(access);
        if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
            this.method(access.name.text, node.parent, builder);
            return;
        }
        this.classify(access, fieldOf(builder, access.name.text));
    }

    /**
     * Records a method call on a value: an array method reads the elements its callback reads and returns
     * elements that are read further; any other method uses the value whole.
     * @param name - The method name.
     * @param call - The call.
     * @param builder - What is read from the value.
     */
    private method(name: string, call: ts.CallExpression, builder: ShapeBuilder): void {
        const readsElements: boolean = ELEMENT_CALLBACK_METHODS.has(name) || ACCUMULATOR_CALLBACK_METHODS.has(name)
            || COMPARATOR_METHODS.has(name) || ELEMENT_RETURNING_METHODS.has(name) || ELEMENTS_RETURNING_METHODS.has(name);
        if (!readsElements) {
            builder.whole = true;
            return;
        }
        this.bindCallback(name, call, itemsOf(builder));
        if (ELEMENT_RETURNING_METHODS.has(name)) {
            this.classify(call, itemsOf(builder));
        }
        else if (ELEMENTS_RETURNING_METHODS.has(name)) {
            this.classify(call, builder);
        }
    }

    /**
     * Records what an array method's callback reads from the elements it receives.
     * @param name - The method name.
     * @param call - The call.
     * @param items - What is read from the elements.
     */
    private bindCallback(name: string, call: ts.CallExpression, items: ShapeBuilder): void {
        const indices: number[] = elementParameterIndices(name);
        if (indices.length === 0) {
            return;
        }
        const callback: ts.Expression | undefined = call.arguments[0];
        if (callback === undefined) {
            // `sort()` without a comparator compares the elements as strings
            items.whole = items.whole || COMPARATOR_METHODS.has(name);
            return;
        }
        if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
            items.whole = true;
            return;
        }
        for (const index of indices) {
            const parameter: ts.ParameterDeclaration | undefined = callback.parameters[index];
            if (parameter !== undefined) {
                this.bindName(parameter.name, items);
            }
        }
    }

    /**
     * Records what the variables a binding declares read from the value it binds.
     * @param name - The binding name or pattern.
     * @param builder - What is read from the value.
     */
    private bindName(name: ts.BindingName, builder: ShapeBuilder): void {
        if (ts.isIdentifier(name)) {
            const variable: ts.Symbol | undefined = symbolOf(name);
            if (variable === undefined) {
                builder.whole = true;
                return;
            }
            this.bindVariable(variable, builder);
            return;
        }
        if (ts.isArrayBindingPattern(name)) {
            for (const element of name.elements.filter(ts.isBindingElement)) {
                this.bindName(element.name, element.dotDotDotToken == undefined ? itemsOf(builder) : builder);
            }
            return;
        }
        for (const element of name.elements) {
            const key: ts.PropertyName | ts.BindingName = element.propertyName ?? element.name;
            if (element.dotDotDotToken != undefined || !(ts.isIdentifier(key) || ts.isStringLiteral(key) || ts.isNumericLiteral(key))) {
                builder.whole = true;
                continue;
            }
            this.bindName(element.name, fieldOf(builder, key.text));
        }
    }

    /**
     * Records what a loop variable reads from the elements it iterates.
     * @param initializer - The loop's variable declaration or target.
     * @param items - What is read from the elements.
     */
    private bindLoopVariable(initializer: ts.ForInitializer, items: ShapeBuilder): void {
        if (ts.isVariableDeclarationList(initializer) && initializer.declarations.length === 1) {
            this.bindName(initializer.declarations[0].name, items);
            return;
        }
        items.whole = true;
    }
}

/**
 * The parameters of an array method's callback that receive elements.
 * @param name - The method name.
 * @returns The parameter positions (empty for a method whose callback receives none).
 */
function elementParameterIndices(name: string): number[] {
    if (ELEMENT_CALLBACK_METHODS.has(name)) {
        return [0];
    }
    if (ACCUMULATOR_CALLBACK_METHODS.has(name)) {
        return [1];
    }
    return COMPARATOR_METHODS.has(name) ? [0, 1] : [];
}

/**
 * The outermost of the parentheses and type-only wrappers around an expression, which do not change
 * the value.
 * @param expression - The expression.
 * @returns The wrapper whose parent uses the value.
 */
function outermostWrapper(expression: ts.Expression): ts.Expression {
    let current: ts.Expression = expression;
    while (isValuePreservingWrapper(current.parent) && current.parent.expression === current) {
        current = current.parent;
    }
    return current;
}

/**
 * Whether a node wraps an expression without changing its value.
 * @param node - The node.
 * @returns True for parentheses, `as`, `satisfies`, `<T>x` and `x!`.
 */
function isValuePreservingWrapper(node: ts.Node): node is ts.ParenthesizedExpression | ts.AsExpression | ts.SatisfiesExpression
    | ts.TypeAssertion | ts.NonNullExpression {
    return ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
        || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node);
}

/**
 * Whether a use only tests a value - whether it exists, is truthy or is nullish - without reading it.
 * @param node - The use.
 * @param parent - Its parent.
 * @returns True for a condition, a negation, `typeof`, the left side of `&&` and a comparison with null.
 */
function isOnlyTested(node: ts.Node, parent: ts.Node): boolean {
    if ((ts.isIfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent)) && parent.expression === node) {
        return true;
    }
    if ((ts.isForStatement(parent) && parent.condition === node) || (ts.isConditionalExpression(parent) && parent.condition === node)) {
        return true;
    }
    if ((ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken) || ts.isTypeOfExpression(parent)) {
        return true;
    }
    if (!ts.isBinaryExpression(parent)) {
        return false;
    }
    if (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && parent.left === node) {
        return true;
    }
    const comparesWithNull: boolean = [parent.left, parent.right].some(side => side.kind === ts.SyntaxKind.NullKeyword
        || (ts.isIdentifier(side) && side.text === 'undefined'));
    return comparesWithNull && [
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken
    ].includes(parent.operatorToken.kind);
}

/**
 * Whether a use hands the value on as the value of its parent: an operand of `||`, `??` or the right
 * side of `&&`, or a branch of a conditional.
 * @param node - The use.
 * @param parent - Its parent.
 * @returns True when the parent can evaluate to the value itself.
 */
function isPassedThrough(node: ts.Node, parent: ts.Node): parent is ts.Expression {
    if (ts.isConditionalExpression(parent)) {
        return parent.condition !== node;
    }
    if (!ts.isBinaryExpression(parent)) {
        return false;
    }
    const operator: ts.SyntaxKind = parent.operatorToken.kind;
    return operator === ts.SyntaxKind.BarBarToken
        || operator === ts.SyntaxKind.QuestionQuestionToken
        || (operator === ts.SyntaxKind.AmpersandAmpersandToken && parent.right === node);
}

/**
 * A builder that records nothing yet.
 * @returns The builder.
 */
function emptyBuilder(): ShapeBuilder {
    return { whole: false, fields: new Map<string, ShapeBuilder>(), items: undefined };
}

/**
 * The builder of a field, created when it is first read.
 * @param builder - The builder of the value.
 * @param field - The field.
 * @returns The field's builder.
 */
function fieldOf(builder: ShapeBuilder, field: string): ShapeBuilder {
    const existing: ShapeBuilder | undefined = builder.fields.get(field);
    if (existing !== undefined) {
        return existing;
    }
    const created: ShapeBuilder = emptyBuilder();
    builder.fields.set(field, created);
    return created;
}

/**
 * The builder of the elements, created when they are first read.
 * @param builder - The builder of the value.
 * @returns The elements' builder.
 */
function itemsOf(builder: ShapeBuilder): ShapeBuilder {
    builder.items ??= emptyBuilder();
    return builder.items;
}

/**
 * The shape a builder recorded.
 * @param builder - The builder.
 * @returns The shape.
 */
function shapeOf(builder: ShapeBuilder): AccessShape {
    if (builder.whole) {
        return 'whole';
    }
    const fields: Record<string, AccessShape> = Object.fromEntries(
        [...builder.fields].map(([field, fieldBuilder]) => [field, shapeOf(fieldBuilder)])
    );
    return builder.items === undefined ? { fields } : { fields, items: shapeOf(builder.items) };
}