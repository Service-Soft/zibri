import * as ts from 'typescript';

import { ComponentFunction, ComponentInfo, isPascalCase } from './component';
import { symbolOf } from './symbols';
import { ValidationCode } from './validate';
import { isHookCall } from './walk';
import { Diagnostic, DiagnosticSeverity } from '../diagnostics/diagnostic.model';

/**
 * A ref a component creates, as `const name = useRef()` or `const name = useRefs()` at its top.
 */
type CreatedRef = {
    /**
     * The call creating it.
     */
    call: ts.CallExpression,
    /**
     * The variable it is assigned to.
     */
    name: string,
    /**
     * The variable's symbol, which every use of it resolves to.
     */
    symbol: ts.Symbol,
    /**
     * Whether it is `useRefs`, which holds every element it is put on.
     */
    many: boolean,
    /**
     * Whether it needs an element.
     */
    required: boolean
};

/**
 * Where a ref is used in the markup of its component.
 */
type RefSites = {
    /**
     * The `ref` attributes of elements it is put on.
     */
    elements: ts.JsxAttribute[],
    /**
     * The attributes of components it is handed to.
     */
    components: ts.JsxAttribute[]
};

/**
 * Rejects a ref created or put somewhere it cannot work, as far as one file shows it. What a component of
 * another file does with a ref handed to it only its render shows.
 *
 * A ref is created at the top of a component, as `const name = useRef()`, since the page finds it by that
 * name, with `{ required: true | false }` written in place or nothing. It is put on an element or handed to a
 * component. A ref of `useRef` holds one element, so it is not put on an element in a loop or on two elements
 * that can both render, and a required one is on an element on every path of the component.
 * @param components - The components of the template.
 * @returns One diagnostic per misused ref.
 */
export function validateRefs(components: ComponentInfo[]): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const { fn } of components) {
        forEachDescendant(fn, node => {
            if (!isHookCall(node, 'useRef') && !isHookCall(node, 'useRefs')) {
                return;
            }
            const created: CreatedRef | Diagnostic = resolveCreatedRef(node, fn);
            const diagnostic: Diagnostic | undefined = 'code' in created ? created : validateUse(created, fn);
            if (diagnostic !== undefined) {
                diagnostics.push(diagnostic);
            }
        });
    }
    return diagnostics;
}

/**
 * Whether a template creates a ref or a state, which are client code: only client code reads a ref or changes a state.
 * @param components - The components of the template.
 * @returns True when one calls `useRef`, `useRefs` or `useState`.
 */
export function createsRefsOrState(components: ComponentInfo[]): boolean {
    let found: boolean = false;
    for (const { fn } of components) {
        forEachDescendant(fn, node => {
            found ||= ['useRef', 'useRefs', 'useState', 'useInput', 'useWritableInput'].some(hook => isHookCall(node, hook));
        });
    }
    return found;
}

/**
 * Reads the ref a call creates, or refuses how it is created.
 * @param call - The `useRef` or `useRefs` call.
 * @param fn - The component.
 * @returns The ref, or the diagnostic refusing it.
 */
function resolveCreatedRef(call: ts.CallExpression, fn: ComponentFunction): CreatedRef | Diagnostic {
    const many: boolean = isHookCall(call, 'useRefs');
    const hook: string = many ? 'useRefs' : 'useRef';
    const declaration: ts.Node = call.parent;
    if (!isNamedAtTop(call, fn) || !ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) {
        return refusal(call, `'${hook}' needs to be called at the top of a component, as \`const name = ${hook}();\`: the page `
            + 'finds the ref by the name of its variable.');
    }
    const required: boolean | undefined = many ? false : readRequired(call);
    if (required === undefined || (many && call.arguments.length > 0)) {
        return refusal(call, many
            ? '\'useRefs\' takes nothing.'
            : '\'useRef\' takes nothing, or `{ required: false }` written in place: whether a ref needs an element is known '
                + 'when the template compiles.');
    }
    const symbol: ts.Symbol | undefined = symbolOf(declaration.name);
    return symbol === undefined
        ? refusal(call, `'${hook}' needs to be assigned to a variable.`)
        : { call, name: declaration.name.text, symbol, many, required };
}

/**
 * Whether a hook is called as the page finds what it creates: assigned to a `const` of its own name, at the top of
 * its component.
 * @param call - The call of the hook.
 * @param fn - The component.
 * @returns True for `const name = hook()` at the top of the component.
 */
export function isNamedAtTop(call: ts.CallExpression, fn: ComponentFunction): boolean {
    const declaration: ts.Node = call.parent;
    const statement: ts.Node | undefined = ts.isVariableDeclaration(declaration) ? declaration.parent.parent : undefined;
    return ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name) && declaration.initializer === call
        && statement !== undefined && ts.isVariableStatement(statement) && statement.parent === fn.body
        && (declaration.parent.flags & ts.NodeFlags.Const) !== 0;
}

/**
 * Whether a `useRef` call creates a required ref.
 * @param call - The call.
 * @returns True or false, or undefined when its argument is anything but `{ required: true | false }` written in place.
 */
function readRequired(call: ts.CallExpression): boolean | undefined {
    if (call.arguments.length === 0) {
        return true;
    }
    const [options] = call.arguments;
    if (call.arguments.length > 1 || !ts.isObjectLiteralExpression(options) || options.properties.length !== 1) {
        return undefined;
    }
    const [property] = options.properties;
    if (!ts.isPropertyAssignment(property) || property.name.getText() !== 'required') {
        return undefined;
    }
    if (property.initializer.kind === ts.SyntaxKind.TrueKeyword) {
        return true;
    }
    return property.initializer.kind === ts.SyntaxKind.FalseKeyword ? false : undefined;
}

/**
 * Refuses where a ref is put, if it cannot work there.
 * @param ref - The ref.
 * @param fn - Its component.
 * @returns The diagnostic, or undefined when it can work where it is put.
 */
function validateUse(ref: CreatedRef, fn: ComponentFunction): Diagnostic | undefined {
    const sites: RefSites = findSites(ref, fn);
    if (sites.elements.length === 0 && sites.components.length === 0) {
        return refusal(ref.call, `The ref '${ref.name}' is put on no element and handed to no component. Put it on an element `
            + `with ref={${ref.name}}.`);
    }
    if (ref.many) {
        return undefined;
    }
    const looped: ts.JsxAttribute | undefined = sites.elements.find(site => isInLoop(site, fn));
    if (looped !== undefined) {
        return refusal(looped, `The ref '${ref.name}' of useRef is put on an element in a loop, and holds one element. Create it `
            + 'with useRefs, which holds every element it is put on.');
    }
    const both: ts.JsxAttribute | undefined = sites.elements.find((site, index) => sites.elements
        .slice(0, index)
        .some(earlier => !areExclusive(earlier, site, fn)));
    if (both !== undefined) {
        return refusal(both, `The ref '${ref.name}' of useRef is put on two elements that can both render, and holds one. `
            + 'Create it with useRefs for several elements.');
    }
    // a component it is handed to may put it on an element or not, which only the render shows
    return ref.required && sites.components.length === 0 && !rendersOnEveryPath(ref, fn)
        ? refusal(ref.call, `The ref '${ref.name}' is required, and a path of the component renders no element it is on. `
        + 'Create it with useRef({ required: false }) when it may be on none.')
        : undefined;
}

/**
 * Finds where a ref is used in the markup of its component.
 * @param ref - The ref.
 * @param fn - Its component.
 * @returns The elements it is put on, and the components it is handed to.
 */
function findSites(ref: CreatedRef, fn: ComponentFunction): RefSites {
    const sites: RefSites = { elements: [], components: [] };
    forEachDescendant(fn, node => {
        if (!ts.isJsxAttribute(node) || !readsRef(attributeValue(node), ref)) {
            return;
        }
        const tag: string = node.parent.parent.tagName.getText();
        if (isPascalCase(tag) || tag.includes('.')) {
            sites.components.push(node);
        }
        else if (node.name.getText() === 'ref') {
            sites.elements.push(node);
        }
    });
    return sites;
}

/**
 * Whether a ref is put on an element inside a loop or a function, which can run any number of times.
 * @param site - The `ref` attribute.
 * @param fn - The component.
 * @returns True when it is.
 */
function isInLoop(site: ts.Node, fn: ComponentFunction): boolean {
    for (let current: ts.Node = site.parent; current !== fn; current = current.parent) {
        if (ts.isFunctionLike(current) || ts.isIterationStatement(current, false)) {
            return true;
        }
    }
    return false;
}

/**
 * Whether two elements a ref is put on never render together: they are in different branches of one
 * condition, or behind different returns.
 * @param first - The `ref` attribute of one.
 * @param second - The `ref` attribute of the other.
 * @param fn - The component.
 * @returns True when at most one of them renders.
 */
function areExclusive(first: ts.Node, second: ts.Node, fn: ComponentFunction): boolean {
    const firstPath: ts.Node[] = pathToComponent(first, fn);
    const secondPath: ts.Node[] = pathToComponent(second, fn);
    if (nearestReturn(firstPath) !== nearestReturn(secondPath)) {
        return true;
    }
    const common: ts.Node | undefined = firstPath.find(node => secondPath.includes(node));
    if (common === undefined) {
        return false;
    }
    const firstBranch: ts.Node | undefined = firstPath[firstPath.indexOf(common) - 1];
    const secondBranch: ts.Node | undefined = secondPath[secondPath.indexOf(common) - 1];
    return ts.isConditionalExpression(common)
        ? firstBranch !== secondBranch && firstBranch !== common.condition && secondBranch !== common.condition
        // eslint-disable-next-line stylistic/max-len
        : ts.isIfStatement(common) && firstBranch !== secondBranch && firstBranch !== common.expression && secondBranch !== common.expression;
}

/**
 * The nodes from one up to its component, the node first.
 * @param node - The node.
 * @param fn - The component.
 * @returns The path, without the component.
 */
function pathToComponent(node: ts.Node, fn: ComponentFunction): ts.Node[] {
    const path: ts.Node[] = [];
    for (let current: ts.Node = node; current !== fn; current = current.parent) {
        path.push(current);
    }
    return path;
}

/**
 * The return statement a path leads through, if any.
 * @param path - The path.
 * @returns The return statement.
 */
function nearestReturn(path: ts.Node[]): ts.Node | undefined {
    return path.find(ts.isReturnStatement);
}

/**
 * Whether every path of a component after a ref is created renders an element the ref is on.
 * @param ref - The ref.
 * @param fn - Its component.
 * @returns True when every return after the ref renders such an element.
 */
function rendersOnEveryPath(ref: CreatedRef, fn: ComponentFunction): boolean {
    const returns: ts.ReturnStatement[] = [];
    forEachDescendant(fn, node => {
        if (ts.isReturnStatement(node) && node.getStart() > ref.call.getEnd() && !isInFunctionOf(node, fn)) {
            returns.push(node);
        }
    });
    return returns.length > 0 && returns.every(statement => statement.expression !== undefined && covers(statement.expression, ref, fn));
}

/**
 * Whether a node is inside a function nested in the component.
 * @param node - The node.
 * @param fn - The component.
 * @returns True when it is.
 */
function isInFunctionOf(node: ts.Node, fn: ComponentFunction): boolean {
    for (let current: ts.Node = node.parent; current !== fn; current = current.parent) {
        if (ts.isFunctionLike(current)) {
            return true;
        }
    }
    return false;
}

/**
 * Whether markup always renders an element a ref is on. A component's children and the markup handed to it are
 * taken as rendered: whether the component renders them only its render shows.
 * @param node - The markup.
 * @param ref - The ref.
 * @param fn - The component.
 * @returns True when every way the markup can render includes such an element.
 */
function covers(node: ts.Node, ref: CreatedRef, fn: ComponentFunction): boolean {
    if (ts.isParenthesizedExpression(node) || ts.isJsxExpression(node)) {
        return node.expression !== undefined && covers(node.expression, ref, fn);
    }
    if (ts.isConditionalExpression(node)) {
        return covers(node.whenTrue, ref, fn) && covers(node.whenFalse, ref, fn);
    }
    if (ts.isJsxFragment(node)) {
        return node.children.some(child => covers(child, ref, fn));
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement = ts.isJsxElement(node) ? node.openingElement : node;
        const values: [name: string, value: ts.Expression][] = opening.attributes.properties.flatMap(attribute => {
            const value: ts.Expression | undefined = ts.isJsxAttribute(attribute) ? attributeValue(attribute) : undefined;
            return ts.isJsxAttribute(attribute) && value !== undefined
                ? [[attribute.name.getText(), value] satisfies [string, ts.Expression]]
                : [];
        });
        const isOn: boolean = values.some(([name, value]) => name === 'ref' && readsRef(value, ref));
        const inAttributes: boolean = values.some(([, value]) => covers(value, ref, fn));
        return isOn || inAttributes || (ts.isJsxElement(node) && node.children.some(child => covers(child, ref, fn)));
    }
    if (ts.isIdentifier(node)) {
        const declaration: ts.Declaration | undefined = symbolOf(node)?.valueDeclaration;
        return declaration !== undefined && ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
            && (declaration.parent.flags & ts.NodeFlags.Const) !== 0 && isWithin(declaration, fn)
            && covers(declaration.initializer, ref, fn);
    }
    return false;
}

/**
 * Whether a node is inside another.
 * @param node - The node.
 * @param container - The other.
 * @returns True when it is.
 */
function isWithin(node: ts.Node, container: ts.Node): boolean {
    return node.getStart() >= container.getStart() && node.getEnd() <= container.getEnd();
}

/**
 * The expression an attribute is given, if it is given one in braces.
 * @param attribute - The attribute.
 * @returns The expression.
 */
function attributeValue(attribute: ts.JsxAttribute): ts.Expression | undefined {
    const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;
    return initializer !== undefined && ts.isJsxExpression(initializer) ? initializer.expression : undefined;
}

/**
 * Whether an expression is the variable of a ref.
 * @param expression - The expression.
 * @param ref - The ref.
 * @returns True when it reads the ref's variable.
 */
function readsRef(expression: ts.Expression | undefined, ref: CreatedRef): boolean {
    return expression !== undefined && ts.isIdentifier(expression) && symbolOf(expression) === ref.symbol;
}

/**
 * Calls a function for every node below one, however deep.
 * @param node - The node.
 * @param visit - The function.
 */
export function forEachDescendant(node: ts.Node, visit: (node: ts.Node) => void): void {
    ts.forEachChild(node, child => {
        visit(child);
        forEachDescendant(child, visit);
    });
}

/**
 * Refuses a node.
 * @param node - Where the mistake is.
 * @param message - What is wrong, and what to write instead.
 * @returns The diagnostic.
 */
function refusal(node: ts.Node, message: string): Diagnostic {
    return {
        code: ValidationCode.REF_MISUSED,
        message,
        severity: DiagnosticSeverity.ERROR,
        span: { start: node.getStart(), end: node.getEnd() }
    };
}