import ts from 'typescript';
import { Diagnostic, DiagnosticSeverity } from 'zibri-tsx';

import { ComponentFunction, ComponentInfo } from './component';
import { ValidationCode } from './validate';
import { forEachDescendant } from './validate-refs';
import { isHookCall } from './walk';

/**
 * Rejects an effect the page could not run as written: one called anywhere but as a statement of its own at the top
 * of a component, and one whose list is anything but a non-empty array written in place, as the compiler and the reader
 * both need to see what makes it run again.
 * @param components - The components of the template.
 * @returns One diagnostic per misused effect.
 */
export function validateEffects(components: ComponentInfo[]): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const { fn } of components) {
        forEachDescendant(fn, node => {
            if (isHookCall(node, 'useEffect')) {
                const diagnostic: Diagnostic | undefined = validateEffect(node, fn);
                if (diagnostic !== undefined) {
                    diagnostics.push(diagnostic);
                }
            }
        });
    }
    return diagnostics;
}

/**
 * Checks one call of `useEffect`.
 * @param call - The call.
 * @param fn - The component.
 * @returns The diagnostic refusing it, or undefined when it is fine.
 */
function validateEffect(call: ts.CallExpression, fn: ComponentFunction): Diagnostic | undefined {
    if (!ts.isExpressionStatement(call.parent) || call.parent.parent !== fn.body) {
        return refusal(call, '\'useEffect\' needs to be called at the top of a component, as a statement of its own: the page runs '
            + 'the effects of each component once its setup has run.');
    }
    const list: ts.Expression | undefined = call.arguments[1];
    if (list === undefined || !ts.isArrayLiteralExpression(list)) {
        return refusal(list ?? call, '\'useEffect\' needs the states and functions it runs again for, as an array written in place, '
            + 'such as `useEffect(() => { ... }, [count])`.');
    }
    if (list.elements.length === 0) {
        return refusal(list, '\'useEffect\' needs at least one state or function to run again for. Use onClient for code that runs '
            + 'once when the page starts.');
    }
    const spread: ts.Expression | undefined = list.elements.find(ts.isSpreadElement);
    return spread !== undefined
        ? refusal(spread, '\'useEffect\' needs each state and function of its list written in it, so it is seen what makes it '
        + 'run again.')
        : undefined;
}

/**
 * A diagnostic refusing an effect.
 * @param node - What it points at.
 * @param message - What is wrong.
 * @returns The diagnostic.
 */
function refusal(node: ts.Node, message: string): Diagnostic {
    return {
        code: ValidationCode.EFFECT_MISUSED,
        message,
        severity: DiagnosticSeverity.ERROR,
        span: { start: node.getStart(), end: node.getEnd() }
    };
}