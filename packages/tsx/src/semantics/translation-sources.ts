import { walk, WalkNode, WalkVisitor } from './walk';
import { Expression, ObjectExpression, ObjectMember, TaggedTemplateExpression, TemplateLiteral } from '../parser/ast';

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
 * @returns The collected sources and whether they are complete.
 */
export function collectTranslationSources(nodes: WalkNode[]): TranslationSources {
    const sources: string[] = [];
    let complete: boolean = true;

    const visit: WalkVisitor = (current: WalkNode): void => {
        if (current.kind !== 'TaggedTemplateExpression' || !isTranslationTag(current)) {
            return;
        }
        const source: string | undefined = staticSourceOf(current.quasi);
        if (source === undefined) {
            complete = false;
            return;
        }
        if (!sources.includes(source)) {
            sources.push(source);
        }
    };

    for (const node of nodes) {
        walk(node, visit);
    }

    return { sources, complete };
}

/**
 * Whether a tagged template is tagged with `$t` or `$ts`.
 * @param expression - The tagged template to check.
 * @returns True for a translation tag.
 */
function isTranslationTag(expression: TaggedTemplateExpression): boolean {
    return expression.tag.kind === 'Identifier' && (expression.tag.name === '$t' || expression.tag.name === '$ts');
}

/**
 * Builds the source string of a translation template, the same way `$t` does at runtime.
 * @param quasi - The template literal of the tagged template.
 * @returns The source string, or undefined when a placeholder name is only known at runtime.
 */
function staticSourceOf(quasi: TemplateLiteral): string | undefined {
    let source: string = '';
    for (let i: number = 0; i < quasi.quasis.length; i++) {
        source += quasi.quasis[i].replaceAll('{', '{{').replaceAll('}', '}}');

        if (i < quasi.expressions.length) {
            const key: string | undefined = placeholderName(quasi.expressions[i], i);
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
function placeholderName(expression: Expression, index: number): string | undefined {
    if (expression.kind === 'ObjectExpression') {
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
function singleKeyOf(expression: ObjectExpression): string | undefined {
    if (expression.properties.length !== 1) {
        return undefined;
    }
    const property: ObjectMember = expression.properties[0];
    if (property.kind !== 'ObjectProperty' || property.computed) {
        return undefined;
    }
    if (property.key.kind === 'Identifier') {
        return property.key.name;
    }
    return property.key.kind === 'StringLiteral' ? property.key.value : undefined;
}

/**
 * Whether an expression could evaluate to an object, and therefore to a single key object.
 * @param expression - The interpolated expression.
 * @returns True when the value is not provably a non object.
 */
function mayBeSingleKeyObject(expression: Expression): boolean {
    switch (expression.kind) {
        // Primitives, functions, arrays and regexes never satisfy `$t`'s single key object check.
        case 'StringLiteral':
        case 'NumericLiteral':
        case 'BooleanLiteral':
        case 'NullLiteral':
        case 'RegexLiteral':
        case 'TemplateLiteral':
        case 'TaggedTemplateExpression':
        case 'ArrayExpression':
        case 'ArrowFunctionExpression':
        case 'FunctionExpression':
        case 'UnaryExpression':
        case 'UpdateExpression':
        case 'BinaryExpression': {
            return false;
        }
        // An object literal is handled before this point; everything else can hold any value.
        case 'Identifier':
        case 'ThisExpression':
        case 'ObjectExpression':
        case 'LogicalExpression':
        case 'AssignmentExpression':
        case 'ConditionalExpression':
        case 'CallExpression':
        case 'NewExpression':
        case 'MemberExpression':
        case 'ParenthesizedExpression':
        case 'SequenceExpression':
        case 'SpreadElement':
        // A lowered jsx element is a `{ __raw }` object, which is single keyed.
        case 'JSXElement':
        case 'JSXFragment': {
            return true;
        }
    }
}