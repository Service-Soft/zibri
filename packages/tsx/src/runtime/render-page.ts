import { projectValue } from './access-shape';
import { isRefMarker } from './refs';
import { RenderEnvironment, reportRenderMistake } from './render-environment';
import { toScriptValue } from './script-value';
import { ClientInstanceEntry, CompiledComponent, createServerRuntime, isClientPropMarker, isPartReference, PartRecord, renderChild,
    RenderRegistry, RenderServerRuntime, resolveReferencedKeys, TemplateRecord } from './server-runtime';
import { CLIENT_HOOK_SOURCES, HookData, substituteHookPlaceholders } from '../codegen/client/hooks';
import { vendorFileName } from '../vendor-file-name';

/**
 * A compiled page ready to render. Alias of {@link CompiledComponent} — a page is just the root
 * component.
 */
export type CompiledPage = CompiledComponent;

/**
 * Canonical order for the render-data hooks, so dependencies are defined before their users
 * (`$ts` is implemented in terms of `$t`).
 */
const HOOK_ORDER: readonly string[] = ['useState', 'useEffect', '$t', '$ts', '$f'];

/**
 * The start of every client script: `onClient`, and what runs each setup on its own and the callbacks
 * once all of them are done.
 */
const CLIENT_STARTUP_SOURCE: string = CLIENT_HOOK_SOURCES['onClient'] ?? '';

/**
 * Locale and formatting data supplied by the host application for the `$t`/`$ts`/`$f` hooks.
 */
export type LocaleData = {
    /**
     * The active locale code.
     */
    locale: string,
    /**
     * Translations by locale, then by source string.
     */
    translations: unknown,
    /**
     * Format options for `$f` (date/time/currency formats).
     */
    formatOptions: unknown
};

/**
 * Options controlling how a page document is assembled.
 */
export type RenderPageOptions = {
    /**
     * Where the page is rendered. A mistake only the render can see, such as a required ref on no element,
     * throws in `development` and is logged in `production`, which renders the page with the broken part
     * degraded. Leaving it out is deprecated, and renders as in `production`.
     */
    environment?: RenderEnvironment,
    /**
     * CSP nonce to place on the injected `<script>`, if the host uses one.
     */
    nonce?: string,
    /**
     * Locale/translation data for the client hooks. Omit when the page uses no localization hooks.
     */
    localeData?: LocaleData,
    /**
     * URL prefix the vendor bundles are served under. Defaults to `/assets/vendor/`.
     */
    vendorUrlPrefix?: string
};

/**
 * Renders a compiled page to a complete HTML document, injecting the client script that restores
 * interactivity (handler registry + per-instance setup call).
 * @param page - The compiled page.
 * @param props - The props to render with.
 * @param options - Where the page is rendered, and how the document is assembled.
 * @returns The full HTML document.
 * @throws In `development`, when the render shows a mistake, such as a required ref on no element.
 */
export function renderPage(
    page: CompiledPage,
    props: Record<string, unknown>,
    options: RenderPageOptions & { environment: RenderEnvironment }
): string;
/**
 * Renders a compiled page as in `production`, where a mistake only the render can see is logged.
 * @param page - The compiled page.
 * @param props - The props to render with.
 * @param options - How the document is assembled.
 * @returns The full HTML document.
 * @deprecated Pass the `environment` the page is rendered in, which decides whether such a mistake throws.
 */
export function renderPage(page: CompiledPage, props?: Record<string, unknown>, options?: RenderPageOptions): string;
// eslint-disable-next-line jsdoc/require-jsdoc
export function renderPage(
    page: CompiledPage,
    props: Record<string, unknown> = {},
    options: RenderPageOptions = {}
): string {
    // what 3.0 rendered with, before a page was told where it renders
    const ssr: RenderServerRuntime = createServerRuntime(options.environment ?? 'production', page.name);
    // The root page's own `?client` packages are not seen by `$ssr.component`, which only sees
    // nested components — seed them here.
    for (const packageName of page.clientPackages ?? []) {
        if (!ssr.vendorPackages.includes(packageName)) {
            ssr.vendorPackages.push(packageName);
        }
    }
    const html: string = renderChild(page.render(props, ssr));
    // only once everything rendered: a ref can be put on an element by any component it is handed to
    validateRefs(ssr);
    const script: string = buildClientScript(page, props, ssr, options.localeData);
    const vendorTags: string = buildVendorTags(ssr.vendorPackages, options.vendorUrlPrefix);
    return wrapDocument(withTemplates(withVendorTags(html, vendorTags), ssr), script, options.nonce);
}

/**
 * Puts the templates the page copies at the end of the body: a `<template>` holds html the browser neither shows nor
 * runs.
 * @param html - The rendered page HTML.
 * @param ssr - The runtime of the finished render.
 * @returns The HTML with the templates.
 */
function withTemplates(html: string, ssr: RenderServerRuntime): string {
    if (ssr.templates.length === 0) {
        return html;
    }
    const tags: string = ssr.templates.map(template => `<template data-zt="${template.id}">${template.html}</template>`).join('');
    // a function replacer keeps `$` sequences in the html literal
    return html.includes('</body>') ? html.replace('</body>', () => `${tags}\n</body>`) : `${html}\n${tags}`;
}

/**
 * Reports a ref the render put on the wrong number of elements: a required `useRef` on none, or a `useRef` on
 * more than one. Each is a mistake only the render can see, as a ref handed to a component of another file
 * is put on an element there. In `production` the page degrades: a required ref on no element throws when
 * client code reads it, and one on several elements holds the first.
 * @param ssr - The runtime of the finished render.
 * @throws In `development`, for the first such ref.
 */
function validateRefs(ssr: RenderServerRuntime): void {
    for (const { entry, stamped, template } of ssr.refs) {
        // the copies of a template are made in the page
        if (entry.many || template) {
            continue;
        }
        if (entry.required && stamped === 0) {
            reportRenderMistake(ssr.environment, `The ref '${entry.name}' of '${entry.component}' is on no element. Put it on one `
                + `with ref={${entry.name}}, or create it with useRef({ required: false }) when it may stay on none.`);
        }
        if (stamped > 1) {
            reportRenderMistake(ssr.environment, `The ref '${entry.name}' of '${entry.component}' is on ${stamped} elements, and `
                + 'useRef holds one. Create it with useRefs for a ref on several elements.');
        }
    }
}

/**
 * Builds the `<script src>` tags for the vendor bundles the rendered components need.
 * @param packages - The `?client` packages collected during the render.
 * @param urlPrefix - URL prefix the bundles are served under.
 * @returns The concatenated script tags, or an empty string.
 */
export function buildVendorTags(packages: string[], urlPrefix: string = '/assets/vendor/'): string {
    const prefix: string = urlPrefix.endsWith('/') ? urlPrefix : `${urlPrefix}/`;
    return packages.map(name => `<script src="${prefix}${vendorFileName(name)}"></script>`).join('\n');
}

/**
 * Inserts the vendor tags into the document head (or before the client script when there is no
 * head), so the globals exist before the client setup runs.
 * @param html - The rendered page HTML.
 * @param vendorTags - The vendor script tags (may be empty).
 * @returns The HTML with vendor tags inserted.
 */
function withVendorTags(html: string, vendorTags: string): string {
    if (vendorTags.length === 0) {
        return html;
    }
    // A function replacer keeps `$` sequences in the tags literal.
    return html.includes('</head>') ? html.replace('</head>', () => `${vendorTags}\n</head>`) : `${vendorTags}\n${html}`;
}

/**
 * Builds the body of the injected client `<script>`: the handler registry, the render-data hooks
 * the client needs, each component's setup definition (once), and one setup call per rendered
 * instance carrying only the props that instance's client code references.
 * @param page - The compiled page (the root instance).
 * @param props - The props the page was rendered with.
 * @param ssr - The runtime used for the render, holding the handler and instance registries.
 * @param localeData - Locale/translation data for the hooks, when needed.
 * @returns The script body, or an empty string when nothing needs to run on the client.
 */
export function buildClientScript(
    page: CompiledPage,
    props: Record<string, unknown>,
    ssr: RenderServerRuntime,
    localeData?: LocaleData
): string {
    const pageEntries: ClientInstanceEntry[] = pageEntry(page, props);
    const registries: RenderRegistry[] = [ssr.registry, ...ssr.parts.map(part => part.registry), ...ssr.templates.map(template => template.registry)];
    const entries: ClientInstanceEntry[] = [...pageEntries, ...registries.flatMap(registry => registry.instances)];
    if (entries.length === 0) {
        return '';
    }

    const parts: string[] = [CLIENT_STARTUP_SOURCE];
    parts.push(...hookSources(collectHooks(entries), entries, localeData));

    // One definition per component type, then one call per instance (function scope isolates them).
    const defined: Set<string> = new Set<string>();
    for (const entry of entries) {
        if (!defined.has(entry.setupName)) {
            defined.add(entry.setupName);
            parts.push(entry.code);
        }
    }
    // what the page sets up when it takes over a part of markup it renders again, or copies a template
    if (ssr.parts.length > 0) {
        parts.push(`__zibriParts = {\n${recordEntries(ssr.parts, ssr)}\n};`);
    }
    if (ssr.templates.length > 0) {
        parts.push(`__zibriTemplates = {\n${recordEntries(ssr.templates, ssr)}\n};`);
    }
    parts.push(...setupCalls(ssr.registry, pageEntries, ssr));
    // the onClient callbacks, once every setup has run
    parts.push('__zibriStart();');
    return parts.join('\n');
}

/**
 * The entries of the table of parts or templates: a function by id, which sets up what rendering it registered.
 * @param records - The parts or templates.
 * @param ssr - The runtime of the finished render.
 * @returns The entries' source.
 */
function recordEntries(records: (PartRecord | TemplateRecord)[], ssr: RenderServerRuntime): string {
    return records
        .map(record => [record.id, setupCalls(record.registry, [], ssr)] as const)
        .filter(([, calls]) => calls.length > 0)
        .map(([id, calls]) => `${toScriptValue(id)}: () => {\n${calls.join('\n')}\n}`)
        .join(',\n');
}

/**
 * What sets up what a registry holds: what an instance outside it registered there, such as the children it handed a
 * component that shows them again, the props of parts forwarded to an element, and a setup call per instance.
 * @param registry - The registry.
 * @param pageEntries - The page itself, when it is the page's registry.
 * @param ssr - The runtime of the finished render.
 * @returns The statements.
 */
function setupCalls(registry: RenderRegistry, pageEntries: ClientInstanceEntry[], ssr: RenderServerRuntime): string[] {
    const instances: ClientInstanceEntry[] = [...pageEntries, ...registry.instances];
    const own: Set<number> = new Set(instances.map(entry => entry.owner));
    const outer: number[] = [...new Set([...registry.handlers, ...registry.bindings, ...registry.regions, ...registry.clientProps]
        .map(entry => entry.owner))]
        .filter(owner => !own.has(owner));
    const calls: string[] = outer.map(owner => `__zibriAttachTo(${owner}, ${toScriptValue(attachData(registry, owner, ssr))});`);
    if (registry.partBindings.length > 0 || registry.partHandlers.length > 0) {
        calls.push(`__zibriPartEntries(${toScriptValue({ bindings: registry.partBindings, handlers: registry.partHandlers })});`);
    }
    for (const entry of instances) {
        // Each instance is handed only the handlers and function props it declared, so running the
        // same setup again for the next instance cannot attach this instance's elements a second time.
        const data: string = toScriptValue({
            ...attachData(registry, entry.owner, ssr),
            // by the name of the variable, which is how the setup asks for one
            refs: Object.fromEntries(registry.refs.filter(ref => ref.owner === entry.owner).map(ref => [ref.entry.name, ref.entry])),
            // the value each state has once the server rendered, narrowed to what the setup reads of it
            states: Object.fromEntries(registry.states
                .filter(state => state.owner === entry.owner && entry.stateShapes?.[state.name] !== undefined)
                .map(state => [state.name, projectValue(state.handle.value, entry.stateShapes?.[state.name] ?? 'whole')]))
        });
        // what the setup reads with useInput that follows a state: the handle the instance handing it builds
        const inputs: Record<string, unknown> = Object.fromEntries(registry.inputs
            .filter(input => input.owner === entry.owner && input.source !== undefined)
            .map(input => [input.name, input.source]));
        const runtime: string = Object.keys(inputs).length === 0
            ? data
            : `${data.slice(0, -1)},"inputs":${serializeInstanceProps(inputs)}}`;
        // each setup on its own: one that throws is reported, and the rest of the page still starts
        calls.push(`__zibriRunSetup(() => ${entry.setupName}(${serializeInstanceProps(entry.props)}, ${runtime}));`);
    }
    return calls;
}

/**
 * What the attach function of an instance is handed from a registry: the instance, its handlers, the functions it
 * builds for its children, its bindings, its conditions and lists, and their templates.
 * @param registry - The registry.
 * @param owner - The instance.
 * @param ssr - The runtime of the finished render.
 * @returns The data.
 */
function attachData(registry: RenderRegistry, owner: number, ssr: RenderServerRuntime): Record<string, unknown> {
    const templates: Record<string, Record<string, string>> | undefined = ssr.templatesOf(owner);
    return {
        owner,
        handlers: registry.handlers.filter(handler => handler.owner === owner),
        props: registry.clientProps.filter(prop => prop.owner === owner),
        ...registry.bindings.some(binding => binding.owner === owner)
            ? { bindings: registry.bindings.filter(binding => binding.owner === owner) }
            : {},
        ...registry.regions.some(region => region.owner === owner)
            ? { regions: registry.regions.filter(region => region.owner === owner) }
            : {},
        ...templates === undefined ? {} : { templates }
    };
}

/**
 * Serializes an instance's props for its setup call. Values are plain JSON except for client-prop
 * references, which become a lookup of the function the declaring instance built, and references to a prop of a part.
 * @param props - The instance's client-referenced props.
 * @returns The JavaScript source of the props object.
 */
function serializeInstanceProps(props: Record<string, unknown>): string {
    if (!Object.values(props).some(value => isClientPropMarker(value) || isRefMarker(value) || isPartReference(value))) {
        return toScriptValue(props);
    }
    const entries: string[] = Object.entries(props).map(([name, value]) => {
        let source: string;
        if (isClientPropMarker(value)) {
            // a declaring instance whose setup threw has no result, and its child gets undefined
            source = `__zibriProp(${value.owner}, ${toScriptValue(value.id)})`;
        }
        else if (isPartReference(value)) {
            // computed from the branch or the row of the part
            source = `__zibriPartValue(${toScriptValue(value.part)}, ${toScriptValue(value.prop)})`;
        }
        else {
            // a ref is a handle the page builds from its entry, whichever instance created it
            source = isRefMarker(value) ? `__zibriRef(${toScriptValue(value.entry)})` : toScriptValue(value);
        }
        return `${toScriptValue(name)}:${source}`;
    });
    return `{${entries.join(',')}}`;
}

/**
 * The root page as a client instance entry, when it has client behavior.
 * @param page - The compiled page.
 * @param props - The props the page was rendered with.
 * @returns A single-element array, or an empty one.
 */
function pageEntry(page: CompiledPage, props: Record<string, unknown>): ClientInstanceEntry[] {
    const { code, setupName, referencedProps, propShapes, stateShapes, referencedHooks, referencedTranslations } = page.client;
    if (!code || !setupName) {
        return [];
    }
    const selected: Record<string, unknown> = {};
    for (const name of resolveReferencedKeys(props, referencedProps)) {
        if (name in props && typeof props[name] !== 'function') {
            // only what the client reads from the prop reaches the page
            selected[name] = projectValue(props[name], propShapes?.[name] ?? 'whole');
        }
    }
    // The page renders first, so it owns instance 0 - the id `createServerRuntime` starts out with.
    return [{ name: page.name, setupName, code, referencedHooks, referencedTranslations, stateShapes, owner: 0, props: selected }];
}

/**
 * Collects the render-data hooks needed across all instances, in dependency order.
 * @param entries - The client instances.
 * @returns The hook names to inline.
 */
function collectHooks(entries: ClientInstanceEntry[]): string[] {
    const needed: Set<string> = new Set<string>();
    for (const entry of entries) {
        for (const hook of entry.referencedHooks) {
            needed.add(hook);
        }
    }
    return HOOK_ORDER.filter(hook => needed.has(hook));
}

/**
 * Resolves the sources of the render-data hooks the client references, with placeholders filled.
 * @param hooks - The hook names to inline.
 * @param entries - The client instances, used to narrow the translation table.
 * @param localeData - The locale/translation data.
 * @returns The hook source snippets.
 */
function hookSources(hooks: string[], entries: ClientInstanceEntry[], localeData?: LocaleData): string[] {
    if (hooks.length === 0) {
        return [];
    }
    const data: HookData = {
        locale: localeData?.locale ?? '',
        translations: narrowTranslations(localeData?.translations ?? {}, entries),
        formatOptions: localeData?.formatOptions ?? {}
    };
    return hooks
        .map(hook => CLIENT_HOOK_SOURCES[hook])
        .filter((source): source is string => source !== undefined)
        .map(source => substituteHookPlaceholders(source, data));
}

/**
 * Drops every translation the client cannot ask for, keeping the page small.
 *
 * All locales are kept — a `$t` token can be resolved for any of them — but only the source strings
 * the client code actually looks up. When any component could not resolve its sources statically the
 * table is passed through untouched, so a lookup never silently falls back to the source string.
 * @param translations - The full translation table supplied by the host.
 * @param entries - The client instances.
 * @returns The narrowed table, or the original one.
 */
function narrowTranslations(translations: unknown, entries: ClientInstanceEntry[]): unknown {
    const sources: Set<string> = new Set<string>();
    for (const entry of entries) {
        // A component compiled before this data existed also counts as incomplete.
        if (entry.referencedTranslations?.complete !== true) {
            return translations;
        }
        for (const source of entry.referencedTranslations.sources) {
            sources.add(source);
        }
    }
    if (!isTranslationTable(translations)) {
        return translations;
    }

    const narrowed: Record<string, Record<string, string>> = {};
    for (const [locale, bySource] of Object.entries(translations)) {
        const kept: Record<string, string> = {};
        for (const source of sources) {
            const translation: string | undefined = bySource?.[source];
            if (translation !== undefined) {
                kept[source] = translation;
            }
        }
        // The locale key is kept even when empty, so `$t`'s locale fallback chain behaves the same.
        narrowed[locale] = kept;
    }
    return narrowed;
}

/**
 * Whether a value has the locale to source to translation shape the client hooks expect.
 * @param value - The value to check.
 * @returns True when the table can be narrowed.
 */
function isTranslationTable(value: unknown): value is Record<string, Record<string, string> | undefined> {
    return typeof value === 'object'
        && value !== null
        && Object.values(value).every(bySource => bySource == undefined || typeof bySource === 'object');
}

/**
 * Wraps rendered HTML in a complete document, injecting the client script before `</body>` when
 * present (otherwise appending it) and prefixing the doctype.
 * @param html - The rendered page HTML.
 * @param script - The client script body (may be empty).
 * @param nonce - The CSP nonce for the script tag, if any.
 * @returns The full HTML document.
 */
export function wrapDocument(html: string, script: string, nonce?: string): string {
    if (script.trim().length === 0) {
        return `<!DOCTYPE html>\n${html}`;
    }
    const nonceAttr: string = nonce ? ` nonce="${nonce}"` : '';
    // Neutralize any `</script` inside the emitted code so it cannot terminate the tag early. An html
    // parser ends a script on it in any case and followed by whitespace, `/` or `>`, so every one is
    // escaped; `<\/` is the same two characters inside a javascript string or regex. The data in the
    // script cannot contain one at all, see toScriptValue.
    const safe: string = script.replaceAll(/<\/script/gi, match => `<\\/${match.slice(2)}`);
    const tag: string = `<script${nonceAttr}>\n${safe}\n</script>`;
    // A function replacer is required: generated code can contain `$$`, `$&` and friends, which a
    // string replacement would interpret as substitution patterns and corrupt.
    const body: string = html.includes('</body>')
        ? html.replace('</body>', () => `${tag}\n</body>`)
        : `${html}\n${tag}`;
    return `<!DOCTYPE html>\n${body}`;
}