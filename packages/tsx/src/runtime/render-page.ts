import { projectValue } from './access-shape';
import { ClientInstanceEntry, CompiledComponent, createServerRuntime, isClientPropMarker, renderChild,
    RenderServerRuntime } from './server-runtime';
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
const HOOK_ORDER: readonly string[] = ['$t', '$ts', '$f'];

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
 * @param options - Document assembly options.
 * @returns The full HTML document.
 */
export function renderPage(
    page: CompiledPage,
    props: Record<string, unknown> = {},
    options: RenderPageOptions = {}
): string {
    const ssr: RenderServerRuntime = createServerRuntime();
    // The root page's own `?client` packages are not seen by `$ssr.component`, which only sees
    // nested components — seed them here.
    for (const packageName of page.clientPackages ?? []) {
        if (!ssr.vendorPackages.includes(packageName)) {
            ssr.vendorPackages.push(packageName);
        }
    }
    const html: string = renderChild(page.render(props, ssr));
    const script: string = buildClientScript(page, props, ssr, options.localeData);
    const vendorTags: string = buildVendorTags(ssr.vendorPackages, options.vendorUrlPrefix);
    return wrapDocument(withVendorTags(html, vendorTags), script, options.nonce);
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
    if (html.includes('</head>')) {
        return html.replace('</head>', () => `${vendorTags}\n</head>`);
    }
    return `${vendorTags}\n${html}`;
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
    const entries: ClientInstanceEntry[] = [...pageEntry(page, props), ...ssr.instances];
    if (entries.length === 0) {
        return '';
    }

    const parts: string[] = [];
    parts.push(...hookSources(collectHooks(entries), entries, localeData));

    // One definition per component type, then one call per instance (function scope isolates them).
    const defined: Set<string> = new Set<string>();
    for (const entry of entries) {
        if (!defined.has(entry.setupName)) {
            defined.add(entry.setupName);
            parts.push(entry.code);
        }
    }
    // An instance that declared functions for its children binds its setup's result, so those calls
    // can pick the functions up. Instances are emitted parent first, so the binding always exists.
    const declaring: Set<number> = new Set(ssr.clientProps.map(entry => entry.owner));
    for (const entry of entries) {
        // Each instance is handed only the handlers and function props it declared, so running the
        // same setup again for the next instance cannot attach this instance's elements a second time.
        const runtime: string = JSON.stringify({
            handlers: ssr.handlers.filter(handler => handler.owner === entry.owner),
            props: ssr.clientProps.filter(prop => prop.owner === entry.owner)
        });
        const call: string = `${entry.setupName}(${serializeInstanceProps(entry.props)}, ${runtime});`;
        parts.push(declaring.has(entry.owner) ? `const ${instanceBinding(entry.owner)} = ${call}` : call);
    }
    return parts.join('\n');
}

/**
 * The name binding an instance's setup result, i.e. The functions it built for its children.
 * @param owner - The instance id.
 * @returns The binding name.
 */
function instanceBinding(owner: number): string {
    return `__ssrInstance${owner}`;
}

/**
 * Serializes an instance's props for its setup call. Values are plain JSON except for client-prop
 * references, which become a lookup into the declaring instance's setup result.
 * @param props - The instance's client-referenced props.
 * @returns The JavaScript source of the props object.
 */
function serializeInstanceProps(props: Record<string, unknown>): string {
    if (!Object.values(props).some(isClientPropMarker)) {
        return JSON.stringify(props);
    }
    const entries: string[] = Object.entries(props).map(([name, value]) => {
        const source: string = isClientPropMarker(value)
            ? `${instanceBinding(value.owner)}[${JSON.stringify(value.id)}]`
            : JSON.stringify(value);
        return `${JSON.stringify(name)}:${source}`;
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
    const { code, setupName, referencedProps, propShapes, referencedHooks, referencedTranslations } = page.client;
    if (!code || !setupName) {
        return [];
    }
    const selected: Record<string, unknown> = {};
    for (const name of referencedProps) {
        if (name in props && typeof props[name] !== 'function') {
            // only what the client reads from the prop reaches the page
            selected[name] = projectValue(props[name], propShapes?.[name] ?? 'whole');
        }
    }
    // The page renders first, so it owns instance 0 - the id `createServerRuntime` starts out with.
    return [{ name: page.name, setupName, code, referencedHooks, referencedTranslations, owner: 0, props: selected }];
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
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    return Object.values(value).every(bySource => bySource == undefined || typeof bySource === 'object');
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
    // Neutralize any `</script>` inside the emitted code so it cannot terminate the tag early.
    const safe: string = script.replaceAll('</script>', '<\\/script>');
    const tag: string = `<script${nonceAttr}>\n${safe}\n</script>`;
    // A function replacer is required: generated code can contain `$$`, `$&` and friends, which a
    // string replacement would interpret as substitution patterns and corrupt.
    const body: string = html.includes('</body>')
        ? html.replace('</body>', () => `${tag}\n</body>`)
        : `${html}\n${tag}`;
    return `<!DOCTYPE html>\n${body}`;
}