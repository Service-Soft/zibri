import { TranslationSources } from '../semantics/translation-sources';

/**
 * A pre-rendered, trusted HTML fragment. Wrapping lowered JSX in this marker lets
 * {@link renderChild} tell safe HTML (emitted by the compiler) apart from dynamic text that must
 * be escaped.
 */
export type Raw = {
    /**
     * The trusted HTML string.
     */
    __raw: string
};

/**
 * HTML tags that are self-closing and may not have children or a closing tag.
 */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set<string>([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr'
]);

/**
 * JSX prop names that map to a different HTML attribute name.
 */
const ATTRIBUTE_NAME_MAP: Readonly<Record<string, string>> = {
    className: 'class',
    htmlFor: 'for'
};

/**
 * Prop names that never render as HTML attributes.
 */
const NON_ATTRIBUTE_PROPS: ReadonlySet<string> = new Set<string>(['children', 'key', 'ref', 'dangerouslySetInnerHTML']);

/**
 * Wraps a trusted HTML string as {@link Raw}.
 * @param html - The trusted HTML.
 * @returns The wrapped value.
 */
export function raw(html: string): Raw {
    return { __raw: html };
}

/**
 * Emits a trusted HTML string as an element, unescaped. The template-facing form of {@link raw}, for
 * markup JSX cannot express - most notably the Outlook conditional comments (`<!--[if mso]>...`) MJML
 * wraps its layout in, which are siblings rather than a subtree.
 *
 * Server-only: the compiler lowers a `$raw(...)` call to a `$ssr.raw(...)` call, so client code that
 * uses it fails to compile like any other server import used on the client.
 * @param html - The trusted HTML.
 * @returns The wrapped value, usable anywhere a JSX child is.
 */
export function $raw(html: string): Raw {
    return { __raw: html };
}

/**
 * Whether a value is a {@link Raw} marker.
 * @param value - The value to test.
 * @returns True when the value is a Raw marker.
 */
export function isRaw(value: unknown): value is Raw {
    return typeof value === 'object' && value !== null && typeof (value as Raw).__raw === 'string';
}

/**
 * Escapes text content for safe inclusion in HTML element bodies.
 * @param value - The text to escape.
 * @returns The escaped text.
 */
export function escapeText(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

/**
 * Escapes a value for safe inclusion in a double-quoted attribute.
 * @param value - The attribute value to escape.
 * @returns The escaped value.
 */
export function escapeAttribute(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

/**
 * Renders a style prop value (object or string) to an inline CSS string.
 * @param value - The style object or pre-formatted string.
 * @returns The inline CSS.
 */
export function renderStyle(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value !== 'object' || value === null) {
        return '';
    }
    return Object.entries(value)
        .filter(([, v]) => v != undefined && v !== false)
        .map(([k, v]) => `${kebabCase(k)}:${String(v)}`)
        .join(';');
}

// eslint-disable-next-line jsdoc/require-jsdoc
function kebabCase(name: string): string {
    // Preserve CSS custom properties (--var) as-is.
    if (name.startsWith('--')) {
        return name;
    }
    return name.replaceAll(/[A-Z]/g, m => `-${m.toLowerCase()}`);
}

/**
 * Renders a single attribute to its ` name="value"` HTML form. Event handlers and functions are
 * skipped (they are attached client-side), as are null/undefined/false values.
 * @param name - The JSX prop name.
 * @param value - The prop value.
 * @returns The serialized attribute (including a leading space) or an empty string.
 */
export function attr(name: string, value: unknown): string {
    // A client-prop reference stands in for a function, so it is skipped for the same reason: a
    // capitalized tag holding an element name gets one before the runtime knows it is not a component.
    if (NON_ATTRIBUTE_PROPS.has(name) || isEventHandler(name) || typeof value === 'function' || isClientPropMarker(value)) {
        return '';
    }
    if (value == undefined || value === false) {
        return '';
    }
    const mapped: string = ATTRIBUTE_NAME_MAP[name] ?? name;
    if (value === true) {
        return ` ${mapped}`;
    }
    if (name === 'style') {
        return ` style="${escapeAttribute(renderStyle(value))}"`;
    }
    return ` ${mapped}="${escapeAttribute(primitiveToString(value))}"`;
}

/**
 * Serializes all own enumerable properties of an object as HTML attributes (for `{...spread}`).
 * @param props - The object whose properties become attributes.
 * @returns The concatenated attributes.
 */
export function spreadAttributes(props: unknown): string {
    if (typeof props !== 'object' || props === null) {
        return '';
    }
    return Object.entries(props).map(([k, v]) => attr(k, v))
        .join('');
}

/**
 * Renders a child value to HTML: escaping text, passing {@link Raw} through, flattening arrays, and
 * dropping null/undefined/boolean values.
 * @param value - The child value.
 * @returns The rendered HTML.
 */
export function renderChild(value: unknown): string {
    if (value == undefined || typeof value === 'boolean') {
        return '';
    }
    if (isRaw(value)) {
        return value.__raw;
    }
    if (typeof value === 'string') {
        return escapeText(value);
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return value.map(renderChild).join('');
    }
    // Objects/functions/symbols cannot be rendered as content.
    return '';
}

/**
 * Converts a primitive value to a string, yielding an empty string for objects and functions.
 * @param value - The value to stringify.
 * @returns The string form, or empty for non-primitives.
 */
function primitiveToString(value: unknown): string {
    if (typeof value === 'symbol') {
        return value.toString();
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
        return String(value);
    }
    return '';
}

// eslint-disable-next-line jsdoc/require-jsdoc
function isEventHandler(name: string): boolean {
    return name.length > 2 && name.startsWith('on') && name[2] === name[2].toUpperCase();
}

/**
 * The server-runtime helper namespace referenced by generated render functions (as `$ssr`).
 */
export type ServerRuntime = {
    /**
     * Wraps trusted HTML as {@link Raw}.
     */
    raw: typeof raw,
    /**
     * Renders a child value to HTML (escaping text, passing Raw through).
     */
    child: typeof renderChild,
    /**
     * Renders a single attribute.
     */
    attr: typeof attr,
    /**
     * Renders all attributes of a spread object.
     */
    spread: typeof spreadAttributes
};

/**
 * The server-runtime helper namespace referenced by generated render functions (as `$ssr`).
 */
export const serverRuntime: ServerRuntime = {
    raw,
    child: renderChild,
    attr,
    spread: spreadAttributes
};

/**
 * A registered handler instance collected during a single render.
 */
export type HandlerRegistryEntry = {
    /**
     * The unique instance id stamped into `data-ssr-handlers`.
     */
    id: string,
    /**
     * The build-time handler site id.
     */
    site: string,
    /**
     * The DOM event name.
     */
    event: string,
    /**
     * The captured loop/closure values for this instance.
     */
    captured: unknown[],
    /**
     * The component instance that declared the handler, i.e. The one whose setup holds the factory.
     * Only that instance may wire this entry up, so instances of the same component - and different
     * components that happen to share a site id - never attach each other's handlers.
     */
    owner: number
};

/**
 * A handler marker created at the handler's definition site and threaded through component props
 * until it reaches the host element that owns it.
 */
export type HandlerMarker = {
    /**
     * Marks this object as a handler marker.
     */
    __marker: true,
    /**
     * The build-time handler site id.
     */
    site: string,
    /**
     * The captured loop/closure values.
     */
    captured: unknown[],
    /**
     * The component instance that declared the handler, carried along so the element stamping it
     * attributes the handler to its definition site rather than to whoever renders the element.
     */
    owner: number
};

/**
 * A function passed as a plain prop to a nested component. The value itself cannot travel into the
 * page, so the child receives this reference and the declaring parent's setup builds the real
 * function on the client.
 */
export type ClientPropMarker = {
    /**
     * Marks this object as a client-prop reference.
     */
    __propMarker: true,
    /**
     * The build-time site id.
     */
    site: string,
    /**
     * The render-time instance id, unique across the page.
     */
    id: string,
    /**
     * The captured loop/closure values.
     */
    captured: unknown[],
    /**
     * The component instance that declared the function, i.e. The one whose setup builds it.
     */
    owner: number
};

/**
 * One client-prop instance created during a render, so the declaring instance's setup can build it.
 */
export type ClientPropRegistryEntry = {
    /**
     * The render-time instance id.
     */
    id: string,
    /**
     * The build-time site id.
     */
    site: string,
    /**
     * The captured loop/closure values.
     */
    captured: unknown[],
    /**
     * The component instance that declared the function.
     */
    owner: number
};

/**
 * A stamping spec for a handler whose site is defined on this element.
 */
export type NewHandlerSpec = {
    /**
     * The build-time handler site id.
     */
    site: string,
    /**
     * The DOM event name.
     */
    event: string,
    /**
     * The captured loop/closure values.
     */
    captured: unknown[]
};

/**
 * A stamping spec for a handler forwarded from a parent as a marker prop.
 */
export type MarkerHandlerSpec = {
    /**
     * The forwarded marker, or undefined when the handler prop was not provided.
     */
    marker: HandlerMarker | undefined,
    /**
     * The DOM event name.
     */
    event: string
};

/**
 * A stamping spec for one handler on one element.
 */
export type HandlerSpec = NewHandlerSpec | MarkerHandlerSpec;

/**
 * Renders an element whose tag name only became known at render time, because it was written as a
 * capitalized identifier (`const Tag = 'h1'; <Tag/>`) and is indistinguishable from a component at
 * compile time.
 * @param tag - The resolved tag name.
 * @param props - The props the element was given, including its children.
 * @param on - The runtime's handler stamping function.
 * @returns The rendered element.
 */
function renderDynamicElement(
    tag: string,
    props: Record<string, unknown>,
    on: (specs: HandlerSpec[]) => string
): Raw {
    const specs: HandlerSpec[] = [];
    let attributes: string = '';

    for (const [name, value] of Object.entries(props)) {
        if (isEventHandler(name)) {
            // A handler on a component element arrives as a marker, which is stamped like any other.
            if (isHandlerMarker(value)) {
                specs.push({ marker: value, event: name.slice(2).toLowerCase() });
            }
            continue;
        }
        if (name !== 'children') {
            attributes += attr(name, value);
        }
    }

    const stamp: string = on(specs);
    if (VOID_ELEMENTS.has(tag)) {
        return raw(`<${tag}${attributes}${stamp}>`);
    }
    return raw(`<${tag}${attributes}${stamp}>${renderChild(props['children'])}</${tag}>`);
}

/**
 * Whether a value is a handler marker forwarded through props.
 * @param value - The value to check.
 * @returns True for a marker.
 */
function isHandlerMarker(value: unknown): value is HandlerMarker {
    return typeof value === 'object' && value !== null && ('__marker' in value) && value.__marker === true;
}

/**
 * The resolved site and captured values of a handler spec.
 */
type ResolvedHandler = {
    /**
     * The build-time handler site id.
     */
    site: string,
    /**
     * The captured loop/closure values.
     */
    captured: unknown[],
    /**
     * The component instance that declared the handler.
     */
    owner: number
};

/**
 * The client metadata a compiled component carries so the runtime can set it up in the browser.
 */
export type ComponentClientMeta = {
    /**
     * The client setup-function definition, or undefined when the component has no client behavior.
     */
    code: string | undefined,
    /**
     * The name of the setup function to call per instance.
     */
    setupName: string | undefined,
    /**
     * Prop names the client setup references (only these are serialized into the page).
     */
    referencedProps: string[],
    /**
     * Render-data hook names the client setup references.
     */
    referencedHooks: string[],
    /**
     * The translation source strings the client setup looks up. When these are complete, only they
     * are inlined instead of the whole translation table.
     */
    referencedTranslations?: TranslationSources
};

/**
 * A compiled component: its server render plus its client metadata.
 */
export type CompiledComponent = {
    /**
     * The component name.
     */
    name: string,
    /**
     * Renders the component to a {@link Raw} fragment using the given per-render runtime.
     */
    render: (props: Record<string, unknown>, ssr: RenderServerRuntime) => Raw,
    /**
     * The component's client behavior metadata.
     */
    client: ComponentClientMeta,
    /**
     * Packages this component imported with `?client`, which the browser needs as globals from a
     * vendor bundle. Tracked for every rendered component, not only those with client behavior.
     */
    clientPackages?: string[]
};

/**
 * One rendered instance of a component that has client behavior. The runtime emits a `setup(props)`
 * call per entry, so each instance gets its own function scope (no renaming needed).
 */
export type ClientInstanceEntry = {
    /**
     * The component name.
     */
    name: string,
    /**
     * The setup function to call.
     */
    setupName: string,
    /**
     * The setup function definition (emitted once per component).
     */
    code: string,
    /**
     * Render-data hooks the setup references.
     */
    referencedHooks: string[],
    /**
     * The translation source strings the setup looks up.
     */
    referencedTranslations?: TranslationSources,
    /**
     * This instance's id, used to hand it exactly the handlers and client props it declared.
     */
    owner: number,
    /**
     * The client-referenced props for this instance.
     */
    props: Record<string, unknown>
};

/**
 * A render context token: the shared identity a `provideContext`/`useContext` pair matches on, plus
 * the value used when nothing provided it. Created once with {@link createContext} and imported by
 * every component that reads or provides it, so the identity is the same across files.
 *
 * This is a server-only mechanism: values live on the per-render runtime and are read where a
 * component renders, so a section can hand layout down to its columns. It never reaches the browser -
 * client code that references `provideContext`/`useContext` fails to compile, like any other server
 * import used on the client.
 */
export type RenderContext<T> = {
    /**
     * Marks the object as a context token.
     */
    __renderContext: true,
    /**
     * The value {@link RenderServerRuntime.useContext} returns when no ancestor provided one.
     */
    default: T
};

/**
 * Creates a render context with the value used when nothing provides it. Call it once in a shared
 * module and import the token wherever it is provided or read.
 * @param defaultValue - The value read when no ancestor provided one.
 * @returns The context token.
 */
export function createContext<T>(defaultValue: T): RenderContext<T> {
    return { __renderContext: true, default: defaultValue };
}

/**
 * One provided context value on the runtime's stack.
 */
type ContextFrame = {
    /**
     * The token the value was provided for.
     */
    context: RenderContext<unknown>,
    /**
     * The provided value.
     */
    value: unknown
};

/**
 * A per-render server runtime: the stateless helpers plus a handler registry and the helpers that
 * stamp `data-ssr-handlers` (`on`) and create markers for handlers passed to components (`mark`).
 */
export type RenderServerRuntime = ServerRuntime & {
    /**
     * Stamps handler instances for one element and returns the `data-ssr-handlers` attribute.
     */
    on: (specs: HandlerSpec[]) => string,
    /**
     * Creates a handler marker for a handler passed to a nested component.
     */
    mark: (site: string, captured: unknown[]) => HandlerMarker,
    /**
     * Creates a client-prop reference for a function passed as a plain prop to a nested component.
     */
    markProp: (site: string, captured: unknown[]) => ClientPropMarker,
    /**
     * Renders a nested compiled component, registering a client instance when it has client
     * behavior so the runtime can call its setup once per instance.
     *
     * Also takes a plain tag name, because a capitalized identifier holding one
     * (`const Tag = 'h1'; <Tag/>`) cannot be told apart from a component at compile time.
     */
    component: (component: CompiledComponent | string, props: Record<string, unknown>, children?: () => unknown) => Raw,
    /**
     * The handler instances collected so far this render.
     */
    handlers: HandlerRegistryEntry[],
    /**
     * The client instances collected so far this render, in render order.
     */
    instances: ClientInstanceEntry[],
    /**
     * The `?client` packages of every component rendered so far, de-duplicated in render order.
     */
    vendorPackages: string[],
    /**
     * The client-prop instances collected so far this render.
     */
    clientProps: ClientPropRegistryEntry[],
    /**
     * Provides a value for a context to everything rendered by the current component, including its
     * lazily rendered children. Removed automatically once that component's render finishes.
     */
    provideContext: <T>(context: RenderContext<T>, value: T) => void,
    /**
     * Reads the value the nearest enclosing provider gave for a context, or its default when none did.
     */
    useContext: <T>(context: RenderContext<T>) => T,
    /**
     * Records a value on a named channel, de-duplicated and in first-seen order. A component deep in
     * the tree uses this to surface something an ancestor needs to know - an email column registering
     * its width so the document can emit the matching responsive rule.
     */
    collect: (channel: string, value: string) => void,
    /**
     * Reads the values recorded on a channel so far, in first-seen order. An ancestor that renders its
     * children before its own shell (an email document building its head from what the body used) sees
     * everything they collected.
     */
    collected: (channel: string) => string[]
};

/**
 * Creates a fresh per-render server runtime with an isolated handler registry.
 * @returns The render runtime.
 */
export function createServerRuntime(): RenderServerRuntime {
    const handlers: HandlerRegistryEntry[] = [];
    const clientProps: ClientPropRegistryEntry[] = [];
    let counter: number = 0;
    // The instance whose render is currently running. The page root renders first and owns 0; every
    // nested component gets the next id, so an instance can be handed exactly its own handlers.
    let ownerCounter: number = 0;
    let currentOwner: number = 0;
    // Context is dynamic, not lexical: a value is visible to whatever renders while it is on the
    // stack (including lazily forced children), and each component's provides are popped once its
    // render returns. The nearest provider wins, so the stack is searched from the top.
    const contextStack: ContextFrame[] = [];

    // eslint-disable-next-line jsdoc/require-jsdoc
    function provideContext<T>(context: RenderContext<T>, value: T): void {
        contextStack.push({ context: context as RenderContext<unknown>, value });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function useContext<T>(context: RenderContext<T>): T {
        for (let i: number = contextStack.length - 1; i >= 0; i--) {
            if (contextStack[i].context === context) {
                return contextStack[i].value as T;
            }
        }
        return context.default;
    }

    // Values surfaced from deep in the tree to an ancestor that assembles after its children render.
    const channels: Map<string, string[]> = new Map<string, string[]>();

    // eslint-disable-next-line jsdoc/require-jsdoc
    function collect(channel: string, value: string): void {
        const values: string[] = channels.get(channel) ?? [];
        if (!values.includes(value)) {
            values.push(value);
            channels.set(channel, values);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function collected(channel: string): string[] {
        return channels.get(channel) ?? [];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function on(specs: HandlerSpec[]): string {
        const ids: string[] = [];
        for (const spec of specs) {
            const resolved: ResolvedHandler | undefined = resolveSpec(spec, currentOwner);
            if (!resolved) {
                continue;
            }
            const id: string = `${resolved.site}_${counter++}`;
            handlers.push({ id, site: resolved.site, event: spec.event, captured: resolved.captured, owner: resolved.owner });
            ids.push(`${id}:${spec.event}`);
        }
        return ids.length > 0 ? ` data-ssr-handlers="${ids.join('|')}"` : '';
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function mark(site: string, captured: unknown[]): HandlerMarker {
        return { __marker: true, site, captured, owner: currentOwner };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function markProp(site: string, captured: unknown[]): ClientPropMarker {
        const marker: ClientPropMarker = { __propMarker: true, site, id: `${site}_${counter++}`, captured, owner: currentOwner };
        clientProps.push({ id: marker.id, site, captured, owner: marker.owner });
        return marker;
    }

    /**
     * Adds the children as a lazily rendered prop, so they are built when the component reads them
     * rather than before it runs. A component that never reads its children never renders them.
     *
     * The owner is restored to the one that was current when the thunk was created: the children are
     * written in the parent's source, so any handler or client prop among them belongs to the
     * parent's client setup, no matter which component ends up reading them.
     * @param props - The props the component was given.
     * @param children - Renders the children.
     * @returns The props, with `children` resolved on first read.
     */
    function withLazyChildren(props: Record<string, unknown>, children: () => unknown): Record<string, unknown> {
        const declaringOwner: number = currentOwner;
        let rendered: boolean = false;
        let value: unknown;
        return Object.defineProperty({ ...props }, 'children', {
            enumerable: true,
            get: (): unknown => {
                if (rendered) {
                    return value;
                }
                const parent: number = currentOwner;
                currentOwner = declaringOwner;
                try {
                    value = children();
                    rendered = true;
                }
                finally {
                    currentOwner = parent;
                }
                return value;
            }
        });
    }

    const instances: ClientInstanceEntry[] = [];
    const vendorPackages: string[] = [];

    const runtime: RenderServerRuntime = {
        raw,
        child: renderChild,
        attr,
        spread: spreadAttributes,
        on,
        mark,
        markProp,
        handlers,
        instances,
        vendorPackages,
        clientProps,
        provideContext,
        useContext,
        collect,
        collected,
        // Registers a client instance (when the component has client behavior), then delegates to
        // its server render, handing it this same runtime so nested renders share the registries.
        component: (compiled: CompiledComponent | string, props: Record<string, unknown>, children?: () => unknown): Raw => {
            const withChildren: Record<string, unknown> = children ? withLazyChildren(props, children) : props;
            // A capitalized identifier holding a tag name (`const Tag = 'h1'; <Tag/>`) looks exactly
            // like a component to the compiler, so the element case is resolved here.
            if (typeof compiled === 'string') {
                return renderDynamicElement(compiled, withChildren, on);
            }
            for (const packageName of compiled.clientPackages ?? []) {
                if (!vendorPackages.includes(packageName)) {
                    vendorPackages.push(packageName);
                }
            }
            const { code, setupName, referencedProps, referencedHooks, referencedTranslations } = compiled.client;
            const owner: number = ++ownerCounter;
            if (code && setupName) {
                instances.push({
                    name: compiled.name,
                    setupName,
                    code,
                    referencedHooks,
                    referencedTranslations,
                    owner,
                    // Deliberately the original props: reading the lazy children here would render
                    // them before the component runs, which is exactly what they are lazy to avoid.
                    // Rendered markup never reaches the page as a prop anyway.
                    props: pickSerializable(props, referencedProps)
                });
            }
            // Handlers and client props declared while this component renders belong to this instance.
            const parent: number = currentOwner;
            currentOwner = owner;
            // Anything this component provides is scoped to its render: its children are forced while
            // building the returned markup, so by the time render returns every descendant has read
            // what it needed and the frames can be dropped.
            const contextDepth: number = contextStack.length;
            try {
                return compiled.render(withChildren, runtime);
            }
            finally {
                currentOwner = parent;
                contextStack.length = contextDepth;
            }
        }
    };
    return runtime;
}

/**
 * Selects the named props whose values can reach the page, dropping functions, rendered markup and
 * handler markers so nothing unintended (or unserializable) reaches the browser.
 *
 * A client-prop reference is kept: it is not the function itself but the pointer the page uses to
 * pick up the one the declaring parent's setup builds.
 * @param props - All props passed to the component.
 * @param names - The prop names the client references.
 * @returns The serializable subset.
 */
function pickSerializable(props: Record<string, unknown>, names: string[]): Record<string, unknown> {
    const selected: Record<string, unknown> = {};
    for (const name of names) {
        const value: unknown = props[name];
        if (!(name in props) || typeof value === 'function' || isRaw(value) || isMarker(value)) {
            continue;
        }
        selected[name] = value;
    }
    return selected;
}

/**
 * Whether a value is a client-prop reference created by `markProp`.
 * @param value - The value to test.
 * @returns True for a client-prop reference.
 */
export function isClientPropMarker(value: unknown): value is ClientPropMarker {
    return typeof value === 'object' && value !== null && '__propMarker' in value;
}

/**
 * Whether a value is a handler marker.
 * @param value - The value to test.
 * @returns True when the value is a handler marker.
 */
function isMarker(value: unknown): boolean {
    return typeof value === 'object' && value !== null && '__marker' in value;
}

/**
 * Resolves a handler spec to its site and captured values, or undefined when a forwarded marker is
 * missing (e.g. An optional handler prop that was not provided).
 * @param spec - The handler spec.
 * @param owner - The instance currently rendering, which owns a handler declared on this element.
 * @returns The site, captured values and owning instance, or undefined.
 */
function resolveSpec(spec: HandlerSpec, owner: number): ResolvedHandler | undefined {
    if ('marker' in spec) {
        // A forwarded handler belongs to the instance that created the marker, not to this one.
        return spec.marker ? { site: spec.marker.site, captured: spec.marker.captured, owner: spec.marker.owner } : undefined;
    }
    return { site: spec.site, captured: spec.captured, owner };
}