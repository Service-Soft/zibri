import ts from 'typescript';

import { LAZY_PROPS, LazyChildren, printNode, SSR, StampSites } from './print';
import { ComponentInfo } from '../../semantics/component';
import { symbolOf } from '../../semantics/symbols';
import { collectBindingSites } from '../client/bindings';
import { collectClientPropSites } from '../client/client-props';
import { collectHandlerSites } from '../client/handlers';
import { collectInputs } from '../client/inputs';
import { collectRegions, RegionCollection } from '../client/regions';
import { concatLines, emitLines, EmittedLines, resolveOrigin } from '../source-map';

/**
 * The generated server render of a component: a function `(props) => Raw` (the component itself)
 * plus a `render(props) => string` entry point.
 */
export type ServerRenderCode = {
    /**
     * The name of the component function in the generated source.
     */
    componentName: string,
    /**
     * The generated source (references the `$ssr` runtime namespace). Type syntax is still in it.
     */
    code: string,
    /**
     * The generated source line by line, with where each line comes from in the template.
     */
    emitted: EmittedLines
};

/**
 * Generates the server-side render code for a component. The emitted `<Name>(props)` function
 * returns a `$ssr.raw` value so it can be composed as a child of other components; the emitted
 * `render(props)` returns the final HTML string.
 * @param component - The component to compile.
 * @returns The generated source and the component function name.
 */
export function compileServerRender(component: ComponentInfo): ServerRenderCode {
    const { fn, name } = component;
    const file: ts.SourceFile = fn.getSourceFile();
    const componentName: string = name === 'default' ? '__Component' : name;
    const lazy: LazyParameter | undefined = fn.parameters.length > 0 ? resolveLazyParameter(fn.parameters[0]) : undefined;
    const regions: RegionCollection = collectRegions(fn);
    const stamps: StampSites = {
        regions: regions.byNode,
        regionTwoWay: regions.twoWay,
        regionParts: regions,
        handlers: collectHandlerSites(fn).byNode,
        clientProps: collectClientPropSites(fn).byNode,
        bindings: collectBindingSites(fn).byNode,
        forwards: collectInputs(fn).forwards,
        lazyChildren: lazy?.children
    };
    let param: string = fn.parameters.length > 0 ? printNode(fn.parameters[0]) : '';
    let prelude: EmittedLines = { lines: [], origins: [] };
    if (lazy !== undefined) {
        param = LAZY_PROPS;
        if (lazy.rest.length > 0) {
            const declared: string = `const { ${lazy.rest.map(element => printNode(element, stamps)).join(', ')} } = ${LAZY_PROPS};`;
            prelude = emitLines(declared, resolveOrigin(fn.parameters[0], file));
        }
    }

    // `$ssr` is the first parameter so the emitted module can pass a fresh per-render runtime
    // (rather than closing over a shared one), and nested components receive the same instance.
    const params: string = param.length > 0 ? `${SSR}, ${param}` : SSR;
    const emitted: EmittedLines = concatLines([
        emitLines(`function ${componentName}(${params}) {`, resolveOrigin(fn, file)),
        prelude,
        emitComponentBody(fn.body, stamps, file),
        emitLines('}', resolveOrigin(fn, file))
    ]);

    return { componentName, code: emitted.lines.join('\n'), emitted };
}

/**
 * A parameter destructuring the children of a component, which the render reads from the props instead.
 */
type LazyParameter = {
    /**
     * The children.
     */
    children: LazyChildren,
    /**
     * The other props it destructures, which are destructured from the props as they are.
     */
    rest: ts.BindingElement[]
};

/**
 * Finds the children a component destructures at the top of its parameter, as `{ children }`, `{ children: content }`
 * or `{ children = fallback }`. A rest element would read them as well, so a parameter with one is left as it is.
 * @param parameter - The parameter of the component.
 * @returns The children and the other props, or undefined when it destructures no children that way.
 */
function resolveLazyParameter(parameter: ts.ParameterDeclaration): LazyParameter | undefined {
    if (!ts.isObjectBindingPattern(parameter.name) || parameter.name.elements.some(element => element.dotDotDotToken != undefined)) {
        return undefined;
    }
    const elements: ts.BindingElement[] = [...parameter.name.elements];
    const children: ts.BindingElement | undefined = elements.find(element => ts.isIdentifier(element.name)
        && (element.propertyName === undefined ? element.name.text : element.propertyName.getText()) === 'children');
    const symbol: ts.Symbol | undefined = children !== undefined && ts.isIdentifier(children.name) ? symbolOf(children.name) : undefined;
    if (children === undefined || symbol === undefined) {
        return undefined;
    }
    return {
        children: { symbol, fallback: children.initializer },
        rest: elements.filter(element => element !== children)
    };
}

/**
 * Prints a component's body, statement by statement, each with the line it is written on. A concise
 * arrow expression body becomes a `return`.
 * @param body - The component body (block or concise expression).
 * @param stamps - The sites to stamp.
 * @param file - The template.
 * @returns The printed statements of the body.
 */
function emitComponentBody(body: ts.ConciseBody | undefined, stamps: StampSites, file: ts.SourceFile): EmittedLines {
    if (body == undefined) {
        return { lines: [], origins: [] };
    }
    return ts.isBlock(body)
        ? concatLines(body.statements.map(statement => emitLines(printNode(statement, stamps), resolveOrigin(statement, file))))
        : emitLines(`return ${printNode(body, stamps)};`, resolveOrigin(body, file));
}