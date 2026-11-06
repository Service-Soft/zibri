import * as ts from 'typescript';

import { isComponentName, isEventHandlerName } from './handlers';
import { regionExpressions } from './regions';
import { isBindingIdentifier } from '../../semantics/binding';
import { ComponentFunction } from '../../semantics/component';
import { symbolOf } from '../../semantics/symbols';
import { isHookCall, walk } from '../../semantics/walk';

/**
 * What a component does with the props it can be handed a value following a state in.
 */
export type InputCollection = {
    /**
     * The props it can take such a value in: those it only forwards as they are, to an attribute of an element, into a
     * text, or to another component, and those it hands to `useInput` or `useWritableInput`.
     */
    inputProps: string[],
    /**
     * Where it forwards one of them to an attribute of an element or into a text, which the page then follows.
     */
    forwards: Set<ts.Expression>
};

/**
 * Attributes of an element a prop is not forwarded to as a value of the page.
 */
const UNFORWARDED_ATTRIBUTES: ReadonlySet<string> = new Set(['key', 'ref', 'dangerouslySetInnerHTML', 'children']);

/**
 * Elements whose whole text is written at once, which a forwarded text cannot follow on its own.
 */
const CONTENT_ELEMENTS: ReadonlySet<string> = new Set(['title', 'textarea']);

/**
 * The hooks reading a value a component is handed.
 */
const INPUT_HOOKS: readonly string[] = ['useInput', 'useWritableInput'];

/**
 * Finds the props a component can take a value following a state in, and where it forwards them. A prop read any other
 * way, in a condition, a computation or client code, would see the marker instead of the value, so it is left out.
 * @param fn - The component.
 * @returns The props, and the forwards.
 */
export function collectInputs(fn: ComponentFunction): InputCollection {
    const parameter: ts.ParameterDeclaration | undefined = fn.parameters[0];
    if (parameter === undefined || fn.body == undefined) {
        return { inputProps: [], forwards: new Set() };
    }
    const props: Map<ts.Symbol, string> = propSymbols(parameter);
    const bare: ts.Symbol | undefined = ts.isIdentifier(parameter.name) ? symbolOf(parameter.name) : undefined;
    const refused: Set<string> = new Set();
    const read: Set<string> = new Set();
    const forwards: Set<ts.Expression> = new Set();
    let bareWhole: boolean = false;
    // a prop read by a condition or a list the browser renders is read by client code
    const regions: Set<ts.Node> = regionExpressions(fn);

    walk(fn.body, node => {
        if (regions.has(node)) {
            walk(node, inner => {
                const symbol: ts.Symbol | undefined = ts.isIdentifier(inner) && !isBindingIdentifier(inner) ? symbolOf(inner) : undefined;
                const name: string | undefined = symbol === undefined ? undefined : props.get(symbol);
                if (name !== undefined) {
                    refused.add(name);
                }
                bareWhole ||= symbol !== undefined && symbol === bare;
            });
            return false;
        }
        if (!ts.isIdentifier(node) || isBindingIdentifier(node)) {
            return true;
        }
        const symbol: ts.Symbol | undefined = symbolOf(node);
        if (symbol === undefined) {
            return true;
        }
        let name: string | undefined = props.get(symbol);
        let reference: ts.Expression = node;
        if (name === undefined && symbol === bare) {
            if (!ts.isPropertyAccessExpression(node.parent) || node.parent.expression !== node) {
                bareWhole = true;
                return true;
            }
            name = node.parent.name.text;
            reference = node.parent;
        }
        if (name === undefined) {
            return true;
        }
        read.add(name);
        const use: 'forward' | 'passed' | undefined = useOf(reference);
        if (use === undefined) {
            refused.add(name);
        }
        else if (use === 'forward') {
            forwards.add(reference);
        }
        return true;
    });

    // a prop that is destructured and never read takes anything, and is listed as well
    const names: string[] = [...new Set([...props.values(), ...read])];
    const inputProps: string[] = bareWhole ? [] : names.filter(name => !refused.has(name));
    return {
        inputProps,
        forwards: new Set([...forwards].filter(reference => inputProps.includes(propNameOf(reference))))
    };
}

/**
 * The props a parameter destructures at its top, by the symbol of their variable. A nested pattern or a rest takes
 * the prop apart, so it is left out.
 * @param parameter - The parameter of the component.
 * @returns The prop names, by symbol.
 */
function propSymbols(parameter: ts.ParameterDeclaration): Map<ts.Symbol, string> {
    const props: Map<ts.Symbol, string> = new Map();
    if (!ts.isObjectBindingPattern(parameter.name)) {
        return props;
    }
    for (const element of parameter.name.elements) {
        if (element.dotDotDotToken != undefined || !ts.isIdentifier(element.name)) {
            continue;
        }
        const symbol: ts.Symbol | undefined = symbolOf(element.name);
        const key: string = element.propertyName === undefined ? element.name.text : element.propertyName.getText();
        if (symbol !== undefined) {
            props.set(symbol, key);
        }
    }
    return props;
}

/**
 * The name of the prop a reference reads.
 * @param reference - An identifier, or `props.name`.
 * @returns The prop name.
 */
function propNameOf(reference: ts.Expression): string {
    if (ts.isPropertyAccessExpression(reference)) {
        return reference.name.text;
    }
    const declaration: ts.Declaration | undefined = ts.isIdentifier(reference) ? symbolOf(reference)?.valueDeclaration : undefined;
    return declaration !== undefined && ts.isBindingElement(declaration) && declaration.propertyName !== undefined
        ? declaration.propertyName.getText()
        : reference.getText();
}

/**
 * How a reference to a prop uses it, when it uses it as it is.
 * @param reference - The reference.
 * @returns `forward` for an attribute of an element or a text, which the page follows; `passed` for a prop of another
 * component or the argument of `useInput`, which carry it on; undefined for any other use.
 */
function useOf(reference: ts.Expression): 'forward' | 'passed' | undefined {
    const parent: ts.Node = reference.parent;
    if (ts.isCallExpression(parent) && parent.arguments[0] === reference && INPUT_HOOKS.some(hook => isHookCall(parent, hook))) {
        return 'passed';
    }
    if (!ts.isJsxExpression(parent)) {
        return undefined;
    }
    const holder: ts.Node = parent.parent;
    if (ts.isJsxAttribute(holder)) {
        const name: string = holder.name.getText();
        const element: ts.JsxOpeningLikeElement = holder.parent.parent;
        if (isEventHandlerName(name) || UNFORWARDED_ATTRIBUTES.has(name)) {
            return undefined;
        }
        return isComponentName(element.tagName) ? 'passed' : 'forward';
    }
    if (ts.isJsxFragment(holder)) {
        return 'forward';
    }
    // the children of a component are rendered by it, and those of a title or a textarea are one text
    return ts.isJsxElement(holder) && !isComponentName(holder.openingElement.tagName)
        && !CONTENT_ELEMENTS.has(holder.openingElement.tagName.getText())
        ? 'forward'
        : undefined;
}
