import { beginHandlerStamping, endHandlerStamping, printPattern, printStatement, printExpression, SSR } from './print';
import { BlockStatement, Expression, Pattern } from '../../parser/ast';
import { ComponentInfo } from '../../semantics/component';
import { collectClientPropSites } from '../client/client-props';
import { collectHandlerSites } from '../client/handlers';

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
     * The generated JavaScript source (references the `$ssr` runtime namespace).
     */
    code: string
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
    const componentName: string = name === 'default' ? '__Component' : name;
    const param: string = fn.params.length > 0 ? printPattern(fn.params[0]) : '';

    beginHandlerStamping(collectHandlerSites(fn).byNode, collectClientPropSites(fn).byNode);
    let body: string;
    try {
        body = printComponentBody(fn.body);
    }
    finally {
        endHandlerStamping();
    }

    // `$ssr` is the first parameter so the emitted module can pass a fresh per-render runtime
    // (rather than closing over a shared one), and nested components receive the same instance.
    const params: string = param.length > 0 ? `${SSR}, ${param}` : SSR;
    const code: string = `function ${componentName}(${params}) ${body}`;

    return { componentName, code };
}

/**
 * Prints a component's body. A concise arrow expression body becomes a `return`.
 * @param body - The component body (block or concise expression).
 * @returns The printed body block source.
 */
function printComponentBody(body: BlockStatement | Expression): string {
    if (body.kind === 'BlockStatement') {
        return `{\n${body.body.map(printStatement).join('\n')}\n}`;
    }
    return `{\nreturn ${printExpression(body)};\n}`;
}

/**
 * Prints just a parameter pattern (exposed for tests and reuse).
 * @param param - The parameter pattern.
 * @returns The printed pattern.
 */
export function printParam(param: Pattern): string {
    return printPattern(param);
}