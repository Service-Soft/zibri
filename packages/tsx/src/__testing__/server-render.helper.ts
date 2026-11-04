import * as ts from 'typescript';

import { ClientScript, compileClientScript } from '../codegen/client/client-codegen';
import { compile } from '../codegen/compile';
import { eraseTypes } from '../codegen/erase-types';
import { compileServerRender, ServerRenderCode } from '../codegen/server/render-codegen';
import { CompiledPage, renderPage } from '../runtime/render-page';
import { SERVER_HOOKS } from '../runtime/server-hooks';
import { ClientInstanceEntry, CompiledComponent, createContext, createServerRuntime, HandlerRegistryEntry, Raw, renderChild, RenderServerRuntime } from '../runtime/server-runtime';
import { collectClientGlobalAliasesFromSource, collectClientPackagesFromSource, parseCompilableTemplate } from '../semantics/client-packages';
import { findComponents, ComponentInfo } from '../semantics/component';
import { parseTemplate, syntaxErrorsOf } from '../semantics/symbols';

/**
 * The result of rendering a component: the HTML plus the registries collected during the render.
 */
export type RenderResult = {
    /**
     * The rendered HTML.
     */
    html: string,
    /**
     * The handler instances collected during the render.
     */
    handlers: HandlerRegistryEntry[],
    /**
     * The client instances collected during the render.
     */
    instances: ClientInstanceEntry[]
};

/**
 * The shape of a generated server render function: it takes the per-render runtime first so a real
 * module can pass a fresh one.
 */
type ServerRenderFn = (ssr: RenderServerRuntime, props: Record<string, unknown>) => Raw;

/**
 * Parses a source and returns its first component.
 * @param source - The source.
 * @returns The first component info.
 * @throws When the source cannot be parsed or contains no component.
 */
function firstComponent(source: string): ComponentInfo {
    const file: ts.SourceFile | undefined = parseCompilableTemplate(source);
    if (file === undefined) {
        throw new Error(`Parse error: ${syntaxErrorsOf(parseTemplate(source))[0]?.message ?? 'no program'}`);
    }
    const components: ComponentInfo[] = findComponents(file);
    if (components.length === 0) {
        throw new Error('No component found in source.');
    }
    return components[0];
}

/**
 * Compiles a single component source into a {@link CompiledComponent}, resolving component
 * references from `deps`. Stands in for the module a build step will emit.
 * @param source - The component source.
 * @param deps - Already-compiled components this one may reference by name.
 * @returns The compiled component.
 */
export function compileComponent(source: string, deps: Record<string, CompiledComponent> = {}): CompiledComponent {
    const info: ComponentInfo = firstComponent(source);
    const server: ServerRenderCode = compileServerRender(info);
    const compiledClient: ClientScript = compileClientScript(info.fn, info.name, collectClientGlobalAliasesFromSource(source));
    const client: ClientScript = {
        ...compiledClient,
        code: compiledClient.code === undefined ? undefined : eraseTypes(compiledClient.code)
    };
    const depNames: string[] = Object.keys(deps);

    // eslint-disable-next-line typescript/no-implied-eval
    const factory: (...args: unknown[]) => ServerRenderFn = new Function(
        'onClient',
        'onServer',
        'createContext',
        ...depNames,
        `${eraseTypes(server.code)}\nreturn ${server.componentName};`
    ) as (...args: unknown[]) => ServerRenderFn;

    const fn: ServerRenderFn = factory(
        SERVER_HOOKS.onClient,
        SERVER_HOOKS.onServer,
        createContext,
        ...depNames.map(name => deps[name])
    );

    return {
        name: info.name,
        render: (props: Record<string, unknown>, ssr: RenderServerRuntime) => fn(ssr, props),
        client,
        clientPackages: collectClientPackagesFromSource(source)
    };
}

/**
 * Compiles a page and the nested components it references into a {@link CompiledPage}.
 * @param pageSource - The page component source.
 * @param componentSources - Nested component sources keyed by their name as referenced in JSX.
 * @returns The compiled page.
 */
export function compilePage(pageSource: string, componentSources: Record<string, string> = {}): CompiledPage {
    const deps: Record<string, CompiledComponent> = {};
    for (const [name, source] of Object.entries(componentSources)) {
        deps[name] = compileComponent(source, deps);
    }
    return compileComponent(pageSource, deps);
}

/**
 * Compiles and renders the first component in the source, returning the HTML and registries.
 * @param source - The component source.
 * @param props - The props to render with.
 * @param deps - Compiled components the source references by name.
 * @returns The HTML and collected registries.
 */
export function renderComponentResult(
    source: string,
    props: Record<string, unknown> = {},
    deps: Record<string, CompiledComponent> = {}
): RenderResult {
    const component: CompiledComponent = compileComponent(source, deps);
    const runtime: RenderServerRuntime = createServerRuntime();
    const html: string = renderChild(component.render(props, runtime));
    return { html, handlers: runtime.handlers, instances: runtime.instances };
}

/**
 * Compiles and renders the first component in the source to HTML.
 * @param source - The component source.
 * @param props - The props to render with.
 * @param deps - Compiled components the source references by name.
 * @returns The rendered HTML.
 */
export function renderComponent(
    source: string,
    props: Record<string, unknown> = {},
    deps: Record<string, CompiledComponent> = {}
): string {
    return renderComponentResult(source, props, deps).html;
}

/**
 * Renders a page that composes nested components, sharing one runtime so handler markers thread
 * across component boundaries and client instances are collected.
 * @param pageSource - The page component source.
 * @param componentSources - Nested component sources keyed by their name as referenced in JSX.
 * @param props - The props to render the page with.
 * @returns The rendered HTML and collected registries.
 */
export function renderWithComponents(
    pageSource: string,
    componentSources: Record<string, string>,
    props: Record<string, unknown> = {}
): RenderResult {
    const page: CompiledPage = compilePage(pageSource, componentSources);
    const runtime: RenderServerRuntime = createServerRuntime();
    const html: string = renderChild(page.render(props, runtime));
    return { html, handlers: runtime.handlers, instances: runtime.instances };
}

/**
 * Whether a value is a compiled component a page can be rendered from.
 * @param value - The value an emitted module exports.
 * @returns True when it carries a render function and client metadata.
 */
export function isCompiledPage(value: unknown): value is CompiledPage {
    return typeof value === 'object' && value !== null
        && 'render' in value && typeof value.render === 'function'
        && 'client' in value && typeof value.client === 'object';
}

/**
 * Evaluates an emitted commonjs module.
 * @param code - The module source.
 * @param requireMock - What the module's `require` hands out.
 * @returns The module's exports.
 */
export function loadCjs(code: string, requireMock: (id: string) => unknown = () => ({})): Record<string, unknown> {
    const exported: Record<string, unknown> = {};
    // eslint-disable-next-line typescript/no-implied-eval
    const run: (exports: Record<string, unknown>, require: (id: string) => unknown) => void = new Function(
        'exports',
        'require',
        code
    ) as (exports: Record<string, unknown>, require: (id: string) => unknown) => void;
    run(exported, requireMock);
    return exported;
}

/**
 * Takes a template the way an application does: through `compile`, with every check it runs, and the
 * emitted module loaded against real values for its imports. `compilePage` skips those checks and takes
 * no imports, so what a page may receive from a server module can only be tested through this.
 * @param source - The template source, exporting `Page`.
 * @param modules - The modules its imports resolve to, by specifier.
 * @param props - The props to render with.
 * @returns The document the browser receives, or undefined when the template does not compile.
 * @throws When the template compiles without exporting `Page`.
 */
export function renderTemplateDocument(
    source: string,
    modules: Record<string, unknown>,
    props: Record<string, unknown> = {}
): string | undefined {
    const code: string | undefined = compile(source, { module: 'cjs' }).code;
    if (code === undefined) {
        return undefined;
    }
    const page: unknown = loadCjs(code, id => modules[id] ?? {})['Page'];
    if (!isCompiledPage(page)) {
        throw new Error('The template does not export a component named Page.');
    }
    return renderPage(page, props);
}

/**
 * Returns the generated server render code for the first component in the source, for snapshotting.
 * @param source - The component source.
 * @returns The generated JavaScript.
 */
export function serverRenderCode(source: string): string {
    return eraseTypes(compileServerRender(firstComponent(source)).code);
}