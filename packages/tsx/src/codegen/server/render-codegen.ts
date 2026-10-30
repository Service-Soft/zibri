import * as ts from 'typescript';

import { printNode, SSR, StampSites } from './print';
import { ComponentInfo } from '../../semantics/component';
import { collectClientPropSites } from '../client/client-props';
import { collectHandlerSites } from '../client/handlers';
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
    const param: string = fn.parameters.length > 0 ? printNode(fn.parameters[0]) : '';

    const stamps: StampSites = { handlers: collectHandlerSites(fn).byNode, clientProps: collectClientPropSites(fn).byNode };

    // `$ssr` is the first parameter so the emitted module can pass a fresh per-render runtime
    // (rather than closing over a shared one), and nested components receive the same instance.
    const params: string = param.length > 0 ? `${SSR}, ${param}` : SSR;
    const emitted: EmittedLines = concatLines([
        emitLines(`function ${componentName}(${params}) {`, resolveOrigin(fn, file)),
        emitComponentBody(fn.body, stamps, file),
        emitLines('}', resolveOrigin(fn, file))
    ]);

    return { componentName, code: emitted.lines.join('\n'), emitted };
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
    if (ts.isBlock(body)) {
        return concatLines(body.statements.map(statement => emitLines(printNode(statement, stamps), resolveOrigin(statement, file))));
    }
    return emitLines(`return ${printNode(body, stamps)};`, resolveOrigin(body, file));
}