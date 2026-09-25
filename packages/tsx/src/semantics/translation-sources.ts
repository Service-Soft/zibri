import * as ts from 'typescript';

import { unwrapTypeSyntax, walk, WalkVisitor } from './walk';

/**
 * The translation source strings a piece of client code looks up.
 */
export type TranslationSources = {
    /**
     * The source strings, in the exact form `$t` builds them at runtime.
     */
    sources: string[],
    /**
     * Whether every `$t`/`$ts` usage could be resolved statically. When false the collected sources
     * are incomplete and the full translation table has to be shipped, because `$t` decides its
     * placeholder names from runtime values.
     */
    complete: boolean
};

/**
 * Collects the translation source strings that the given nodes look up through `$t` or `$ts`.
 *
 * The result mirrors how `$t` builds its source string: literal braces are doubled and each
 * interpolation becomes a placeholder. `$t` names that placeholder after the single key of an object
 * it is passed, falling back to a positional `$n` — a decision it makes at runtime. Only an inline
 * object literal reveals that name statically, so anything else marks the result incomplete rather
 * than guessing.
 * @param nodes - The client side nodes to scan.
 * @param skip - Nodes to leave out, together with everything below them.
 * @returns The collected sources and whether they are complete.
 */
export function collectTranslationSources(nodes: ts.Node[], skip?: ReadonlySet<ts.Node>): TranslationSources {
    const sources: string[] = [];
    let complete: boolean = true;

    const visit: WalkVisitor = (current: ts.Node): void => {
        if (!ts.isTaggedTemplateExpression(current) || !isTranslationTag(current)) {
            return;
        }
        const source: string | undefined = staticSourceOf(current.template);
        if (source === undefined) {
            complete = false;
            return;
        }
        if (!sources.includes(source)) {
            sources.push(source);
        }
    };

    for (const node of nodes) {
        walk(node, visit, skip);
    }

    return { sources, complete };
}

/**
 * Whether a tagged template is tagged with `$t` or `$ts`.
 * @param expression - The tagged template to check.
 * @returns True for a translation tag.
 */
function isTranslationTag(expression: ts.TaggedTemplateExpression): boolean {
    const tag: ts.Expression = unwrapTypeSyntax(expression.tag);
    return ts.isIdentifier(tag) && (tag.text === '$t' || tag.text === '$ts');
}

/**
 * Builds the source string of a translation template, the same way `$t` does at runtime.
 * @param template - The template literal of the tagged template.
 * @returns The source string, or undefined when a placeholder name is only known at runtime.
 */
function staticSourceOf(template: ts.TemplateLiteral): string | undefined {
    const quasis: string[] = ts.isNoSubstitutionTemplateLiteral(template)
        ? [template.rawText ?? template.text]
        : [template.head.rawText ?? template.head.text, ...template.templateSpans.map(span => span.literal.rawText ?? span.literal.text)];
    const expressions: ts.Expression[] = ts.isNoSubstitutionTemplateLiteral(template)
        ? []
        : template.templateSpans.map(span => unwrapTypeSyntax(span.expression));

    let source: string = '';
    for (let i: number = 0; i < quasis.length; i++) {
        source += quasis[i].replaceAll('{', '{{').replaceAll('}', '}}');

        if (i < expressions.length) {
            const key: string | undefined = placeholderName(expressions[i], i);
            if (key === undefined) {
                return undefined;
            }
            source += `{${key}}`;
        }
    }
    return source;
}

/**
 * Resolves the placeholder name `$t` would use for an interpolated expression.
 * @param expression - The interpolated expression.
 * @param index - The index of the interpolation.
 * @returns The placeholder name, or undefined when only the runtime value can decide it.
 */
function placeholderName(expression: ts.Expression, index: number): string | undefined {
    if (ts.isObjectLiteralExpression(expression)) {
        return singleKeyOf(expression);
    }
    // Any other expression may still evaluate to a single key object, in which case `$t` uses that
    // key instead of the positional fallback. That cannot be decided here.
    return mayBeSingleKeyObject(expression) ? undefined : `$${index + 1}`;
}

/**
 * The key of an object literal with exactly one statically known property.
 * @param expression - The object literal.
 * @returns The key, or undefined when it is not a single, statically named property.
 */
function singleKeyOf(expression: ts.ObjectLiteralExpression): string | undefined {
    if (expression.properties.length !== 1) {
        return undefined;
    }
    const property: ts.ObjectLiteralElementLike = expression.properties[0];
    if (ts.isSpreadAssignment(property)) {
        return undefined;
    }
    const name: ts.PropertyName = property.name;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
        return name.text;
    }
    return undefined;
}

/**
 * Operators whose result is one of their operands rather than a new value.
 */
const LOGICAL_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.QuestionQuestionToken
]);

/**
 * Whether an expression could evaluate to an object, and therefore to a single key object.
 * @param expression - The interpolated expression.
 * @returns True when the value is not provably a non object.
 */
function mayBeSingleKeyObject(expression: ts.Expression): boolean {
    // Primitives, functions, arrays and regexes never satisfy `$t`'s single key object check, and
    // neither does the result of an arithmetic, comparison, unary or update operator. `await` is
    // counted among the unary operators here.
    if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression) || ts.isBigIntLiteral(expression)
        || expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword
        || expression.kind === ts.SyntaxKind.NullKeyword || ts.isRegularExpressionLiteral(expression)
        || ts.isNoSubstitutionTemplateLiteral(expression) || ts.isTemplateExpression(expression)
        || ts.isTaggedTemplateExpression(expression) || ts.isArrayLiteralExpression(expression)
        || ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)
        || ts.isTypeOfExpression(expression) || ts.isVoidExpression(expression) || ts.isDeleteExpression(expression)
        || ts.isAwaitExpression(expression) || ts.isPrefixUnaryExpression(expression) || ts.isPostfixUnaryExpression(expression)) {
        return false;
    }
    if (ts.isBinaryExpression(expression)) {
        const operator: ts.SyntaxKind = expression.operatorToken.kind;
        const isAssignment: boolean = operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment;
        return LOGICAL_OPERATORS.has(operator) || isAssignment || operator === ts.SyntaxKind.CommaToken;
    }
    // An object literal is handled before this point; everything else can hold any value, and a
    // lowered jsx element is a `{ __raw }` object, which is single keyed.
    return true;
}