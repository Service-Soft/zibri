import { AccessShape, projectValue, ReferencedProps } from './access-shape';
import { ATTRIBUTE_NAME, ATTRIBUTE_NAME_MAP, URL_ATTRIBUTES } from './attribute-rules';
import { isRefMarker, REF_MARKER, RefEntry, RefMarker } from './refs';
import { RenderEnvironment, reportRenderMistake } from './render-environment';
import type { TranslationSources } from '../semantics/translation-sources';

// What tells the runtime's own objects apart from a value that only looks like one: a property keyed
// by a symbol, which json cannot write, so nothing that came in as data - a json column, a body, a
// provider's answer - passes for trusted html or for a reference the page writes as code. Symbol.for
// rather than a symbol of this module, since the runtime is built for both module systems and a
// template compiled against one copy can be rendered by the other.
const RAW: unique symbol = Symbol.for('zibri-tsx.raw');
const HANDLER_MARKER: unique symbol = Symbol.for('zibri-tsx.handler-marker');
const CLIENT_PROP_MARKER: unique symbol = Symbol.for('zibri-tsx.client-prop-marker');
const INPUT_MARKER: unique symbol = Symbol.for('zibri-tsx.input-marker');
const PART_REFERENCE: unique symbol = Symbol.for('zibri-tsx.part-reference');
const PART_PROP: unique symbol = Symbol.for('zibri-tsx.part-prop');

/**
 * What a value reading a state or a row is while the server renders a template: left out, as the page writes it into
 * each copy.
 */
const UNREAD: unique symbol = Symbol.for('zibri-tsx.unread');

/**
 * A pre-rendered, trusted HTML fragment. Wrapping lowered JSX in this marker lets
 * {@link renderChild} tell safe HTML (emitted by the compiler) apart from dynamic text that must
 * be escaped. Only {@link raw} and {@link $raw} create one.
 */
export type Raw = {
    /**
     * Marks the object as trusted html.
     */
    readonly [RAW]: true,
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
 * Prop names that never render as HTML attributes.
 */
const NON_ATTRIBUTE_PROPS: ReadonlySet<string> = new Set<string>(['children', 'key', 'ref', 'dangerouslySetInnerHTML']);

/**
 * The characters an element name is written with: a letter, then letters, digits, `-` and `:`.
 */
const TAG_NAME: RegExp = /^[A-Za-z][\d:A-Za-z-]*$/;

/**
 * Wraps a trusted HTML string as {@link Raw}.
 * @param html - The trusted HTML.
 * @returns The wrapped value.
 */
export function raw(html: string): Raw {
    return { [RAW]: true, __raw: html };
}

/**
 * Emits a trusted HTML string as an element, unescaped. The template-facing form of `raw`, for
 * markup JSX cannot express - most notably the Outlook conditional comments (`<!--[if mso]>...`) MJML
 * wraps its layout in, which are siblings rather than a subtree.
 *
 * Server-only: the compiler lowers a `$raw(...)` call to a `$ssr.raw(...)` call, so client code that
 * uses it fails to compile like any other server import used on the client.
 * @param html - The trusted HTML.
 * @returns The wrapped value, usable anywhere a JSX child is.
 */
export function $raw(html: string): Raw {
    return raw(html);
}

/**
 * Whether a value is a {@link Raw} marker created by {@link raw}.
 * @param value - The value to test.
 * @returns True when the value is a Raw marker.
 */
export function isRaw(value: unknown): value is Raw {
    return typeof value === 'object' && value !== null && RAW in value && value[RAW] === true
        && '__raw' in value && typeof value.__raw === 'string';
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
    return typeof value !== 'object' || value === null
        ? ''
        : Object.entries(value)
            .filter(([, v]) => v != undefined && v !== false)
            .map(([k, v]) => `${kebabCase(k)}:${String(v)}`)
            .join(';');
}

// eslint-disable-next-line jsdoc/require-jsdoc
function kebabCase(name: string): string {
    // Preserve CSS custom properties (--var) as-is.
    return name.startsWith('--') ? name : name.replaceAll(/[A-Z]/g, m => `-${m.toLowerCase()}`);
}

/**
 * Renders a single attribute to its ` name="value"` HTML form. Event handlers and functions are
 * skipped (they are attached client-side), as are null/undefined/false values.
 * @param name - The JSX prop name.
 * @param value - The prop value.
 * @returns The serialized attribute (including a leading space) or an empty string.
 */
export function attr(name: string, written: unknown): string {
    // a value following a state is written as the value it has now
    const value: unknown = isInputMarker(written) ? written.value : written;
    // A client-prop reference stands in for a function, so it is skipped for the same reason: a
    // capitalized tag holding an element name gets one before the runtime knows it is not a component.
    if (NON_ATTRIBUTE_PROPS.has(name) || typeof value === 'function' || isClientPropMarker(value) || value === UNREAD) {
        return '';
    }
    // handlers are attached on the client, so no name starting with `on` is ever written: a spread of
    // an object holding `onclick` would otherwise render a working inline handler. And only a name made
    // of the characters an attribute name is written with, since a name is not escaped and one holding
    // a space, a quote or `=` would write attributes of its own
    if (name.toLowerCase().startsWith('on') || !ATTRIBUTE_NAME.test(name)) {
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
    const text: string = primitiveToString(value);
    return URL_ATTRIBUTES.has(mapped.toLowerCase()) && isScriptUrl(text) ? '' : ` ${mapped}="${escapeAttribute(text)}"`;
}

/**
 * Whether a url runs script when it is followed.
 * @param url - The url.
 * @returns True for a `javascript:` or `vbscript:` url, however it is spelled.
 */
export function isScriptUrl(url: string): boolean {
    // a browser drops tabs and line breaks anywhere in a url and control characters and spaces around
    // it, so every one of them is dropped before the scheme is read
    const scheme: string = [...url].filter(character => character > ' ').join('')
        .toLowerCase();
    return scheme.startsWith('javascript:') || scheme.startsWith('vbscript:');
}

/**
 * Serializes all own enumerable properties of an object as HTML attributes (for `{...spread}`).
 * @param props - The object whose properties become attributes.
 * @returns The concatenated attributes.
 */
export function spreadAttributes(props: unknown): string {
    return typeof props !== 'object' || props === null
        ? ''
        : Object.entries(props).map(([k, v]) => attr(k, v))
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
    if (isInputMarker(value)) {
        return renderChild(value.value);
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
    return Array.isArray(value)
        ? value.map(renderChild).join('')
        // Objects/functions/symbols cannot be rendered as content.
        : '';
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
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean'
        ? String(value)
        : '';
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
    spread: typeof spreadAttributes,
    /**
     * Marks the option of the value of a select in its rendered options.
     */
    selectOption: typeof selectOption
};

/**
 * The server-runtime helper namespace referenced by generated render functions (as `$ssr`).
 */
export const serverRuntime: ServerRuntime = {
    raw,
    child: renderChild,
    attr,
    spread: spreadAttributes,
    selectOption
};

/**
 * Marks the option a select's value names as selected, as html has no value attribute for a select: the first option
 * whose value, or whose text when it has none, is the value.
 * @param options - The rendered options of the select.
 * @param written - The value of the select.
 * @returns The options, with the one of the value marked.
 */
export function selectOption(options: string, written: unknown): string {
    const value: unknown = isInputMarker(written) ? written.value : written;
    if (value == undefined || typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') {
        return options;
    }
    const text: string = String(value);
    let found: boolean = false;
    return options.replaceAll(/<option\b([^>]*)>([^<]*)/g, (option: string, attributes: string, content: string) => {
        const valueAttribute: RegExpExecArray | null = / value="([^"]*)"/.exec(attributes);
        // both are compared as they are written into the html
        const matches: boolean = valueAttribute === null
            ? content.trim() === escapeText(text)
            : valueAttribute[1] === escapeAttribute(text);
        if (found || !matches) {
            return option;
        }
        found = true;
        return `<option${attributes} selected>${content}`;
    });
}

/**
 * A registered handler instance collected during a single render.
 */
export type HandlerRegistryEntry = {
    /**
     * The unique instance id stamped into `data-ssr`.
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
    readonly [HANDLER_MARKER]: true,
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
    owner: number,
    /**
     * The prop it is, of a component inside markup the browser renders again, which the page computes from the branch
     * or the row instead of a site.
     */
    part?: PartSource
};

/**
 * A prop of a component inside markup the browser renders again: the part of that markup the component is, and the
 * name of the prop.
 */
export type PartSource = {
    /**
     * The id of the part, unique in the page and the same in every copy of a template.
     */
    part: string,
    /**
     * The name of the prop.
     */
    prop: string
};

/**
 * Where a component inside markup the browser renders again reads a prop the page follows, written into the page as
 * a reference to it.
 */
export type PartReference = PartSource & {
    /**
     * Marks this object as a reference to a prop of a part.
     */
    readonly [PART_REFERENCE]: true
};

/**
 * What a component inside markup the browser renders again is handed for a prop the page follows: how it follows it,
 * and a function computing it, which the server does not call while it renders a template.
 */
export type PartProp = {
    /**
     * Marks this object as such a prop.
     */
    readonly [PART_PROP]: true,
    /**
     * A value reading a state or a row, a state itself, or a function.
     */
    kind: 'value' | 'state' | 'function',
    /**
     * Computes it.
     */
    compute: () => unknown
};

/**
 * A prop of a part the component forwards to an attribute or into a text, which the page writes again.
 */
export type PartBindingEntry = PartSource & {
    /**
     * The id the element is stamped with, or the comments around the text are written with.
     */
    id: string,
    /**
     * Where it writes.
     */
    kind: 'attribute' | 'text',
    /**
     * The attribute it writes, for an attribute.
     */
    attribute?: string
};

/**
 * A function of a part the component forwards to an element as a handler.
 */
export type PartHandlerEntry = PartSource & {
    /**
     * The id the element is stamped with.
     */
    id: string,
    /**
     * The DOM event.
     */
    event: string
};

/**
 * What a render registers for the page, for the page itself, for one part of markup the browser renders again, or
 * for one template.
 */
export type RenderRegistry = {
    /**
     * The client instances, in render order.
     */
    instances: ClientInstanceEntry[],
    /**
     * The handler instances.
     */
    handlers: HandlerRegistryEntry[],
    /**
     * The bindings.
     */
    bindings: BindingRegistryEntry[],
    /**
     * The conditions and lists the browser renders again.
     */
    regions: RegionRegistryEntry[],
    /**
     * The functions the instances build for their children.
     */
    clientProps: ClientPropRegistryEntry[],
    /**
     * The refs created.
     */
    refs: RefRegistryEntry[],
    /**
     * The states created.
     */
    states: StateRegistryEntry[],
    /**
     * What the instances read with `useInput` and `useWritableInput`.
     */
    inputs: InputRegistryEntry[],
    /**
     * The props of parts forwarded to an attribute or into a text.
     */
    partBindings: PartBindingEntry[],
    /**
     * The functions of parts forwarded to an element as a handler.
     */
    partHandlers: PartHandlerEntry[]
};

/**
 * A component, or the html of the server, inside markup the browser renders again: what rendering it registered.
 */
export type PartRecord = {
    /**
     * The id of the part.
     */
    id: string,
    /**
     * What rendering it registered.
     */
    registry: RenderRegistry
};

/**
 * A branch or a row the server rendered without its values, which the page copies: its html, and what rendering it
 * registered.
 */
export type TemplateRecord = {
    /**
     * The id of the template.
     */
    id: string,
    /**
     * Its html.
     */
    html: string,
    /**
     * What rendering it registered.
     */
    registry: RenderRegistry
};

/**
 * A condition or a list the browser renders again, for the runtime: what it renders now, and each branch or the row the
 * server renders a template of.
 */
export type RenderForm = {
    /**
     * The id of the form in its component, which its templates are found by.
     */
    form: string,
    /**
     * Renders what holds: the branch, or each row.
     */
    render: () => unknown,
    /**
     * The branches or the row to render a template of, by the slot the page finds it in: `y`, `n` or `row`.
     */
    templates: [string, () => unknown][]
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
    readonly [CLIENT_PROP_MARKER]: true,
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
 * A value handed to a component that follows a state of the component handing it: a state itself, or an expression
 * reading one. It holds the value while the server renders. Where the component forwards it, the page follows it with
 * a binding of the instance that handed it, and `useInput` reads it through that instance's setup.
 */
export type InputMarker = {
    /**
     * Marks this object as a value following a state.
     */
    readonly [INPUT_MARKER]: true,
    /**
     * The build-time binding site of the expression, in the component that handed it.
     */
    site: string,
    /**
     * The captured loop/closure values.
     */
    captured: unknown[],
    /**
     * The instance that handed it, whose setup computes it.
     */
    owner: number,
    /**
     * The value while the server renders.
     */
    readonly value: unknown,
    /**
     * The state, when the state itself was handed.
     */
    state: ServerState | undefined,
    /**
     * The prop it is, of a component inside markup the browser renders again, which the page computes from the branch
     * or the row instead of a site.
     */
    part?: PartSource
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
 * @throws When the tag is not the name of an element.
 */
function renderDynamicElement(
    tag: string,
    props: Record<string, unknown>,
    on: (specs: HandlerSpec[], ref?: unknown, bindings?: BindingSpec[]) => string
): Raw {
    // the name is written as it is, so one holding a space would write attributes of its own
    if (!TAG_NAME.test(tag)) {
        throw new Error(`"${tag}" is not the name of an element.`);
    }
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

    const stamp: string = on(specs, props['ref']);
    return VOID_ELEMENTS.has(tag)
        ? raw(`<${tag}${attributes}${stamp}>`)
        : raw(`<${tag}${attributes}${stamp}>${renderChild(props['children'])}</${tag}>`);
}

/**
 * Whether a value is a handler marker forwarded through props.
 * @param value - The value to check.
 * @returns True for a marker.
 */
function isHandlerMarker(value: unknown): value is HandlerMarker {
    return typeof value === 'object' && value !== null && HANDLER_MARKER in value && value[HANDLER_MARKER] === true;
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
     * The props the client setup references (only these are serialized into the page).
     */
    referencedProps: ReferencedProps,
    /**
     * What the client setup reads from each referenced prop; a prop without an entry is serialized whole.
     */
    propShapes?: Record<string, AccessShape>,
    /**
     * What the client setup reads from the value of each state it reads, by the name of the state's variable. A
     * state without an entry is not written into the page.
     */
    stateShapes?: Record<string, AccessShape>,
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
    clientPackages?: string[],
    /**
     * The props it can be handed a value following a state in: those it forwards as they are, and those it reads with
     * `useInput` or `useWritableInput`.
     */
    inputProps?: string[]
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
     * What the setup reads from the value of each state, by the name of the state's variable.
     */
    stateShapes?: Record<string, AccessShape>,
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
 * A binding of an element: the build-time site, and the values it captured.
 */
export type BindingSpec = {
    /**
     * The build-time binding site id.
     */
    site: string,
    /**
     * The captured loop/closure values.
     */
    captured: unknown[]
};

/**
 * A binding instance collected during a render.
 */
export type BindingRegistryEntry = {
    /**
     * The id stamped on its element, or written in the comments around its text.
     */
    id: string,
    /**
     * The build-time binding site id.
     */
    site: string,
    /**
     * The captured loop/closure values.
     */
    captured: unknown[],
    /**
     * The instance whose setup computes it.
     */
    owner: number,
    /**
     * Where it writes, for a value a component forwards, which its site in the instance handing it does not know.
     */
    kind?: 'attribute' | 'text',
    /**
     * The attribute it writes, for a value a component forwards to one.
     */
    attribute?: string
};

/**
 * A condition or a list rendered during a render, which the browser renders again.
 */
export type RegionRegistryEntry = {
    /**
     * The id written in the comments around it.
     */
    id: string,
    /**
     * The build-time region site id.
     */
    site: string,
    /**
     * The captured loop/closure values.
     */
    captured: unknown[],
    /**
     * The instance whose setup renders it.
     */
    owner: number
};

/**
 * What a component reads with `useInput` or `useWritableInput`, created during a render.
 */
export type InputRegistryEntry = {
    /**
     * The instance that reads it, whose setup finds it by its name.
     */
    owner: number,
    /**
     * The name of its variable.
     */
    name: string,
    /**
     * The reference to the handle the instance that handed it builds, for a value following a state, or undefined for
     * any other value, which the page gets as it is, as the initial value of a state. A prop of a part the page
     * computes from its branch or row.
     */
    source: ClientPropMarker | PartReference | undefined
};

/**
 * A state created during a render: `useState` in a template.
 */
export type StateRegistryEntry = {
    /**
     * The instance that created it, whose setup reads it.
     */
    owner: number,
    /**
     * The name of its variable, which the setup finds it by.
     */
    name: string,
    /**
     * Its handle on the server, whose value at the end of the render is its initial value in the page.
     */
    handle: ServerState
};

/**
 * A state while the server renders: its value, which the markup reads.
 */
export type ServerState = {
    /**
     * The value.
     */
    value: unknown
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
     * The value {@link useContext} returns when no ancestor provided one.
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

// The two hooks below are what a template imports. The compiler lowers a call to either to the
// render runtime of the component it is in (`$ssr.provideContext`, `$ssr.useContext`) and drops the
// import, so these bodies only run when code the compiler never saw calls them - and there is no
// render to provide to or read from.

/**
 * Provides a value for a context to every component the calling component renders, however deep.
 * Call it in the body of a tsx component.
 * @param context - The context to provide a value for.
 * @param value - The value.
 * @throws When called anywhere but in the body of a compiled tsx component.
 */
export function provideContext<T>(context: RenderContext<T>, value: T): void;
/**
 * What a call the compiler never saw runs.
 * @throws Always, as there is no render to provide to.
 */
// the overload above is what a template calls; the body takes nothing, as it only refuses the call
export function provideContext(): void {
    throw new Error('provideContext was called outside a tsx component. Call it in the body of a component in a .tsx template.');
}

/**
 * Reads the value the nearest component above provided for a context, or the context's default when
 * none did. Call it in the body of a tsx component.
 * @param context - The context to read.
 * @returns The value.
 * @throws When called anywhere but in the body of a compiled tsx component.
 */
export function useContext<T>(context: RenderContext<T>): T;
/**
 * What a call the compiler never saw runs.
 * @throws Always, as there is no render to read from.
 */
// the overload above is what a template calls; the body takes nothing, as it only refuses the call
export function useContext(): never {
    throw new Error('useContext was called outside a tsx component. Call it in the body of a component in a .tsx template.');
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
 * stamp `data-ssr` (`on`) and create markers for handlers passed to components (`mark`).
 */
export type RenderServerRuntime = ServerRuntime & {
    /**
     * Where the page is rendered, which decides whether a mistake only the render can see throws.
     */
    environment: RenderEnvironment,
    /**
     * Stamps handler instances, the ref put on the element if it has one, the bindings writing to it, and the values
     * following a state forwarded to its attributes, for one element and returns the `data-ssr` attribute.
     */
    on: (specs: HandlerSpec[], ref?: unknown, bindings?: BindingSpec[], forwards?: [string, unknown][]) => string,
    /**
     * Renders the value of a text hole that reads state, between the comments the browser finds it by.
     */
    text: (site: string, captured: unknown[], value: unknown) => Raw,
    /**
     * Renders a condition or a list the browser renders again, between the comments the browser finds it by, and the
     * templates of its branches or its row.
     */
    region: (site: string, captured: unknown[], form: RenderForm) => Raw,
    /**
     * Renders a text inside markup the browser renders again, between the comments it walks to.
     */
    hole: (value: unknown) => Raw,
    /**
     * Renders a condition or a list inside markup the browser renders again, between the comments it walks to.
     */
    range: (form: RenderForm) => Raw,
    /**
     * A condition the browser renders again, with the branches the server renders a template of.
     */
    when: (
        form: string,
        condition: () => unknown,
        whenTrue: (() => unknown) | undefined,
        whenFalse: (() => unknown) | undefined,
        templateTrue: boolean,
        templateFalse: boolean
    ) => RenderForm,
    /**
     * A list the browser renders again, reporting two rows with the same key, with the row the server renders a
     * template of.
     */
    rows: (
        form: string,
        items: () => unknown,
        row: (item: unknown, index: number) => unknown,
        key: (item: unknown, index: number) => unknown,
        template: boolean
    ) => RenderForm,
    /**
     * A value reading a state or a row: computed, or left out while the server renders a template.
     */
    read: (value: () => unknown) => unknown,
    /**
     * Renders html of the server inside markup the browser renders again, between the comments it walks over.
     */
    opaque: (value: unknown) => Raw,
    /**
     * Renders a component inside markup the browser renders again, as a part of it the page takes over: what rendering it
     * registers is the part's, and its props the page follows are computed from the branch or the row.
     */
    part: (component: CompiledComponent | string, props: Record<string, unknown>, children?: () => unknown) => Raw,
    /**
     * A prop of a part reading a state or a row, or a state itself, computed when the server renders it.
     */
    partValue: (compute: () => unknown, state: boolean) => PartProp,
    /**
     * A function handed to a part.
     */
    partFunction: (compute: () => unknown) => PartProp,
    /**
     * The conditions and lists rendered so far this render, which the browser renders again.
     */
    regions: RegionRegistryEntry[],
    /**
     * What the page itself registered so far this render.
     */
    registry: RenderRegistry,
    /**
     * The parts rendered so far this render, each with what rendering it registered.
     */
    parts: PartRecord[],
    /**
     * The templates rendered so far this render.
     */
    templates: TemplateRecord[],
    /**
     * The templates of the conditions and lists of an instance, by the id of each form and the slot of each branch or
     * the row.
     */
    templatesOf: (owner: number) => Record<string, Record<string, string>> | undefined,
    /**
     * Makes a value handed to a component, or provided to a context, that follows a state.
     */
    input: (site: string, captured: unknown[], value: unknown, handle: boolean) => InputMarker,
    /**
     * Renders a prop forwarded into a text: between the comments the browser finds it by when it follows a state.
     */
    forward: (value: unknown) => unknown,
    /**
     * Reads a value the component rendering is handed: `useInput` in a template.
     */
    useInput: (value: unknown, component: string, name: string) => ServerState,
    /**
     * Takes a state the component rendering is handed, which it may write: `useWritableInput` in a template.
     */
    useWritableInput: (value: unknown, component: string, name: string) => ServerState,
    /**
     * What components read with `useInput` and `useWritableInput` so far this render.
     */
    inputs: InputRegistryEntry[],
    /**
     * The binding instances collected so far this render.
     */
    bindings: BindingRegistryEntry[],
    /**
     * Creates a ref of the component rendering: `useRef` in a template.
     */
    useRef: (options: unknown, component: string, name: string) => RefMarker,
    /**
     * Creates a ref holding every element it is put on: `useRefs` in a template.
     */
    useRefs: (component: string, name: string) => RefMarker,
    /**
     * The refs created so far this render, each with the instance that created it and how many elements
     * it was put on.
     */
    refs: RefRegistryEntry[],
    /**
     * Creates a state of the component rendering: `useState` in a template, whose argument the server runs.
     */
    useState: (initial: unknown, component: string, name: string) => ServerState,
    /**
     * The states created so far this render.
     */
    states: StateRegistryEntry[],
    /**
     * Creates a handler marker for a handler passed to a nested component.
     */
    mark: (site: string, captured: unknown[]) => HandlerMarker,
    /**
     * Creates a client-prop reference for a function passed as a plain prop to a nested component.
     */
    markProp: (site: string, captured: unknown[]) => ClientPropMarker,
    /**
     * Narrows a captured value to what client code reads from it, before it is written into the page.
     */
    project: (value: unknown, shape: AccessShape) => unknown,
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
     * Reads the value the nearest enclosing provider gave for a context, or its default when none did. A value
     * following a state is handed out as one only to `useInput` and `useWritableInput`.
     */
    useContext: <T>(context: RenderContext<T>, forInput?: boolean) => T,
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
 * A ref created during a render.
 */
export type RefRegistryEntry = {
    /**
     * What the page knows of it.
     */
    entry: RefEntry,
    /**
     * The instance that created it, whose setup reads it.
     */
    owner: number,
    /**
     * How many elements it was put on.
     */
    stamped: number,
    /**
     * Whether it was created while the server rendered a template, whose copies the render cannot count.
     */
    template: boolean
};

/**
 * Creates a fresh per-render server runtime with an isolated handler registry.
 * @param environment - Where the page is rendered.
 * @param page - The name of the component rendered first, which a mistake of its own names.
 * @returns The render runtime.
 */
export function createServerRuntime(environment: RenderEnvironment, page?: string): RenderServerRuntime;
/**
 * Creates a fresh per-render server runtime that renders as in `production`, where a mistake only the render can see is
 * logged.
 * @returns The render runtime.
 * @deprecated Pass the environment the page is rendered in, which decides whether such a mistake throws.
 */
export function createServerRuntime(): RenderServerRuntime;
// eslint-disable-next-line jsdoc/require-jsdoc
export function createServerRuntime(environment: RenderEnvironment = 'production', page: string = 'the page'): RenderServerRuntime {
    // what is registered goes to the page, or to the part or the template being rendered, whose copies set it up
    const root: RenderRegistry = createRegistry();
    const registries: RenderRegistry[] = [root];
    const current: () => RenderRegistry = () => registries.at(-1) ?? root;
    const handlers: HandlerRegistryEntry[] = root.handlers;
    const clientProps: ClientPropRegistryEntry[] = root.clientProps;
    // every ref, which the finished render checks
    const refs: RefRegistryEntry[] = [];
    // how deep the server is rendering templates: a value reading a state or a row is left out of one
    let templating: number = 0;
    const parts: PartRecord[] = [];
    const templates: TemplateRecord[] = [];
    // by instance, then by form, then by branch or row
    const templateIds: Map<number, Record<string, Record<string, string>>> = new Map();
    let counter: number = 0;
    // The instance whose render is currently running. The page root renders first and owns 0; every
    // nested component gets the next id, so an instance can be handed exactly its own handlers.
    let ownerCounter: number = 0;
    let currentOwner: number = 0;
    // the name of the component rendering, which a mistake only the render can see names
    let currentComponent: string = page;
    // Context is dynamic, not lexical: a value is visible to whatever renders while it is on the
    // stack (including lazily forced children), and each component's provides are popped once its
    // render returns. The nearest provider wins, so the stack is searched from the top.
    const contextStack: ContextFrame[] = [];

    // eslint-disable-next-line jsdoc/require-jsdoc
    function provideContext<T>(context: RenderContext<T>, value: T): void {
        contextStack.push({ context: context, value });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function useContext<T>(context: RenderContext<T>, forInput: boolean = false): T {
        for (let i: number = contextStack.length - 1; i >= 0; i--) {
            if (contextStack[i].context === context) {
                const value: unknown = contextStack[i].value;
                if (isInputMarker(value) && !forInput) {
                    reportRenderMistake(environment, `'${currentComponent}' reads a context holding a value that follows a state with `
                        + 'useContext alone, which reads the value it has while the server renders. Read it with '
                        + 'useInput(useContext(...)) to follow it.');
                    return value.value as T;
                }
                return value as T;
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
    function createRef(entry: Omit<RefEntry, 'id'>): RefMarker {
        const registered: RefRegistryEntry = { entry: { id: `r${counter++}`, ...entry }, owner: currentOwner, stamped: 0, template: templating > 0 };
        refs.push(registered);
        current().refs.push(registered);
        const marker: RefMarker = { [REF_MARKER]: true, entry: registered.entry };
        // not enumerable, so writing a ref into the page never reads it
        return Object.defineProperty(marker, 'current', {
            enumerable: false,
            get: (): undefined => {
                reportRenderMistake(environment, `The ref '${entry.name}' of '${entry.component}' was read while the server renders, `
                    + 'where it holds no element. Read .current in onClient or in a handler.');
                return undefined;
            }
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function useRef(options: unknown, component: string, name: string): RefMarker {
        const required: boolean = !(typeof options === 'object' && options !== null && Reflect.get(options, 'required') === false);
        return createRef({ name, component, many: false, required });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function useRefs(component: string, name: string): RefMarker {
        return createRef({ name, component, many: true, required: false });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function useState(initial: unknown, _component: string, name: string): ServerState {
        const handle: ServerState = { value: initial };
        current().states.push({ owner: currentOwner, name, handle });
        return handle;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function bind(spec: BindingSpec): string {
        const id: string = `${spec.site}_${counter++}`;
        current().bindings.push({ id, site: spec.site, captured: spec.captured, owner: currentOwner });
        return id;
    }

    /**
     * A binding of the instance that handed a value following a state, writing where a component forwards it. A prop of
     * a part the page computes from its branch or row instead.
     * @param marker - The value.
     * @param kind - Where it writes.
     * @param attribute - The attribute it writes, for an attribute.
     * @returns The id the element is stamped with, or the comments around the text are written with.
     */
    function bindForward(marker: InputMarker, kind: 'attribute' | 'text', attribute?: string): string {
        if (marker.part !== undefined) {
            const id: string = `${marker.part.part}_${counter++}`;
            current().partBindings.push({ id, ...marker.part, kind, attribute });
            return id;
        }
        const id: string = `${marker.site}_${counter++}`;
        current().bindings.push({ id, site: marker.site, captured: marker.captured, owner: marker.owner, kind, attribute });
        return id;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function text(site: string, captured: unknown[], value: unknown): Raw {
        const id: string = bind({ site, captured });
        return raw(`<!--${id}-->${renderChild(value)}<!--/${id}-->`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function read(value: () => unknown): unknown {
        return templating > 0 ? UNREAD : value();
    }

    /**
     * Renders the templates of a form, once for each instance whose markup holds it: each branch, or the row, without
     * its values, registering what it renders for the template.
     * @param form - The form.
     */
    function renderTemplates(form: RenderForm): void {
        for (const [slot, render] of form.templates) {
            const forOwner: Record<string, Record<string, string>> = templateIds.get(currentOwner) ?? {};
            templateIds.set(currentOwner, forOwner);
            const slots: Record<string, string> = forOwner[form.form] ?? {};
            forOwner[form.form] = slots;
            if (slots[slot] !== undefined) {
                continue;
            }
            const id: string = `t${counter++}`;
            slots[slot] = id;
            const registry: RenderRegistry = createRegistry();
            registries.push(registry);
            templating++;
            try {
                templates.push({ id, html: renderChild(render()), registry });
            }
            finally {
                templating--;
                registries.pop();
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function region(site: string, captured: unknown[], form: RenderForm): Raw {
        const id: string = `${site}_${counter++}`;
        current().regions.push({ id, site, captured, owner: currentOwner });
        renderTemplates(form);
        // a template holds none of it, and the page builds it in the copy
        return raw(`<!--${id}-->${templating > 0 ? '' : renderChild(form.render())}<!--/${id}-->`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function range(form: RenderForm): Raw {
        renderTemplates(form);
        return raw(`<!--[-->${templating > 0 ? '' : renderChild(form.render())}<!--]-->`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function when(
        form: string,
        condition: () => unknown,
        whenTrue: (() => unknown) | undefined,
        whenFalse: (() => unknown) | undefined,
        templateTrue: boolean,
        templateFalse: boolean
    ): RenderForm {
        const templated: [string, () => unknown][] = [];
        if (templateTrue && whenTrue !== undefined) {
            templated.push(['y', whenTrue]);
        }
        if (templateFalse && whenFalse !== undefined) {
            templated.push(['n', whenFalse]);
        }
        return { form, render: () => (condition() ? whenTrue : whenFalse)?.(), templates: templated };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function rows(
        form: string,
        items: () => unknown,
        row: (item: unknown, index: number) => unknown,
        key: (item: unknown, index: number) => unknown,
        template: boolean
    ): RenderForm {
        const render: () => unknown = () => {
            const value: unknown = items();
            const list: unknown[] = Array.isArray(value) ? value : [];
            const keys: unknown[] = list.map((item, index) => key(item, index));
            const duplicate: unknown = keys.find((written, index) => keys.indexOf(written) !== index);
            if (duplicate !== undefined) {
                reportRenderMistake(environment, `Two rows of a list of '${currentComponent}' have the key '${String(duplicate)}'. Give each `
                    + 'row a key of its own: the page keeps a row by its key when the list changes.');
            }
            return raw(list.map((item, index) => renderChild(row(item, index))).join(''));
        };
        // the row of a template has no item, and reads none of it: what reads it is left out
        return { form, render, templates: template ? [['row', () => row(undefined, -1)]] : [] };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function opaque(value: unknown): Raw {
        return raw(`<!--{-->${renderChild(value)}<!--}-->`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function part(compiled: CompiledComponent | string, handed: Record<string, unknown>, children?: () => unknown): Raw {
        const id: string = `p${counter++}`;
        const props: Record<string, unknown> = Object.fromEntries(Object.entries(handed)
            .map(([name, value]) => [name, isPartProp(value) ? partMarker({ part: id, prop: name }, value) : value]));
        const registry: RenderRegistry = createRegistry();
        registries.push(registry);
        let html: string;
        try {
            // where the component places them, between the comments the page finds them by
            const placed: (() => unknown) | undefined = children === undefined
                ? undefined
                : () => raw(`<!--(${id}-->${renderChild(children())}<!--)-->`);
            html = renderChild(runtime.component(compiled, props, placed));
        }
        finally {
            registries.pop();
        }
        parts.push({ id, registry });
        return raw(`<!--{${id}-->${html}<!--}-->`);
    }

    /**
     * What a component inside markup the browser renders again is handed for a prop the page follows: a value following a
     * state, or a handler, whose source is the part and the prop.
     * @param source - The part and the prop.
     * @param prop - What it is handed.
     * @returns The value it renders with.
     */
    function partMarker(source: PartSource, prop: PartProp): InputMarker | HandlerMarker {
        if (prop.kind === 'function') {
            return { [HANDLER_MARKER]: true, site: '', captured: [], owner: currentOwner, part: source };
        }
        // a state itself is the component's own, which a template may read; a value of the row it has not
        const state: ServerState | undefined = prop.kind === 'state' ? toState(prop.compute()) : undefined;
        const value: unknown = state === undefined ? read(prop.compute) : undefined;
        return {
            [INPUT_MARKER]: true,
            site: '',
            captured: [],
            owner: currentOwner,
            state,
            part: source,
            get value(): unknown {
                if (state === undefined) {
                    return value;
                }
                return templating > 0 ? UNREAD : state.value;
            }
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function forward(value: unknown): unknown {
        if (!isInputMarker(value)) {
            return value;
        }
        const id: string = bindForward(value, 'text');
        return raw(`<!--${id}-->${renderChild(value.value)}<!--/${id}-->`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function input(site: string, captured: unknown[], value: unknown, handle: boolean): InputMarker {
        const state: ServerState | undefined = handle ? toState(value) : undefined;
        return {
            [INPUT_MARKER]: true,
            site,
            captured,
            owner: currentOwner,
            state,
            get value(): unknown {
                return state === undefined ? value : state.value;
            }
        };
    }

    /**
     * Where the page finds the handle a value following a state is read through: the prop of its part, or the function
     * the instance handing it builds.
     * @param marker - The value.
     * @returns The reference.
     */
    function inputSource(marker: InputMarker): ClientPropMarker | PartReference {
        return marker.part === undefined
            ? markProp(marker.site, marker.captured, marker.owner)
            : { [PART_REFERENCE]: true, ...marker.part };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function useInput(value: unknown, component: string, name: string): ServerState {
        if (!isInputMarker(value)) {
            const handle: ServerState = { value };
            // a value following no state is written into the page as the initial value of a state
            current().inputs.push({ owner: currentOwner, name, source: undefined });
            current().states.push({ owner: currentOwner, name, handle });
            return handle;
        }
        current().inputs.push({ owner: currentOwner, name, source: inputSource(value) });
        return { get value(): unknown {
            const held: unknown = value.value;
            if (held === UNREAD) {
                reportRenderMistake(environment, `'${component}' reads the value of '${name}' while the server renders the markup the `
                    + 'page copies for a branch or a row it builds, where it has none. Read it in the markup or in client code.');
                return undefined;
            }
            return held;
        } };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function useWritableInput(value: unknown, component: string, name: string): ServerState {
        if (isInputMarker(value) && value.state !== undefined) {
            current().inputs.push({ owner: currentOwner, name, source: inputSource(value) });
            return value.state;
        }
        reportRenderMistake(environment, `The input '${name}' of '${component}' is handed a value that is not a state, and `
            + 'useWritableInput writes to the state it is handed. Hand the component the state itself, such as value={email}.');
        // read only in the page, where a write throws
        return useInput(isInputMarker(value) ? value.value : value, component, name);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function on(specs: HandlerSpec[], ref?: unknown, bindingSpecs: BindingSpec[] = [], forwards: [string, unknown][] = []): string {
        const ids: string[] = bindingSpecs.map(bind);
        for (const [attribute, value] of forwards) {
            if (isInputMarker(value)) {
                ids.push(bindForward(value, 'attribute', attribute));
            }
        }
        if (isRefMarker(ref)) {
            const registered: RefRegistryEntry | undefined = refs.find(candidate => candidate.entry === ref.entry);
            // the copies of a template are made in the page, where the render cannot count them
            if (registered !== undefined && templating === 0) {
                registered.stamped++;
            }
            ids.push(ref.entry.id);
        }
        for (const spec of specs) {
            // a function of a part, which the page computes from its branch or row
            const source: PartSource | undefined = 'marker' in spec ? spec.marker?.part : undefined;
            if (source !== undefined) {
                const id: string = `${source.part}_${counter++}`;
                current().partHandlers.push({ id, ...source, event: spec.event });
                ids.push(`${id}:${spec.event}`);
                continue;
            }
            const resolved: ResolvedHandler | undefined = resolveSpec(spec, currentOwner);
            if (!resolved) {
                continue;
            }
            const id: string = `${resolved.site}_${counter++}`;
            current().handlers.push({ id, site: resolved.site, event: spec.event, captured: resolved.captured, owner: resolved.owner });
            ids.push(`${id}:${spec.event}`);
        }
        return ids.length > 0 ? ` data-ssr="${ids.join('|')}"` : '';
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function mark(site: string, captured: unknown[]): HandlerMarker {
        return { [HANDLER_MARKER]: true, site, captured, owner: currentOwner };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    function markProp(site: string, captured: unknown[], owner: number = currentOwner): ClientPropMarker {
        const marker: ClientPropMarker = { [CLIENT_PROP_MARKER]: true, site, id: `${site}_${counter++}`, captured, owner };
        current().clientProps.push({ id: marker.id, site, captured, owner });
        return marker;
    }

    /**
     * A handler a component's client code reads as a prop, wrapping it instead of forwarding it to an
     * element. Stamping does not reach it there, so it becomes a function prop of the instance that
     * declared it, with the values it captured. A function of a part the page computes from its branch or row.
     * @param marker - The handler's marker.
     * @returns The reference the component's setup call picks the function up with.
     */
    function markHandlerProp(marker: HandlerMarker): ClientPropMarker | PartReference {
        return marker.part === undefined
            ? markProp(marker.site, marker.captured, marker.owner)
            : { [PART_REFERENCE]: true, ...marker.part };
    }

    /**
     * Adds the children as a lazily rendered prop, so they are built when the component reads them
     * rather than before it runs. A component that never reads its children never renders them.
     *
     * The owner is restored to the one that was current when the thunk was created: the children are
     * written in the parent's source, so any handler or client prop among them belongs to the
     * parent's client setup, no matter which component ends up reading them.
     * @param props - The props the component was given.
     * @param render - Renders the children.
     * @returns The props, with `children` resolved on first read.
     */
    function withLazyChildren(props: Record<string, unknown>, render: () => unknown): Record<string, unknown> {
        const declaringOwner: number = currentOwner;
        let rendered: boolean = false;
        let value: unknown;
        return Object.defineProperty({ ...props }, 'children', {
            enumerable: true,
            get: (): unknown => {
                // a template renders them again, without their values, registering what they render for the template
                if (rendered && templating === 0) {
                    return value;
                }
                const parent: number = currentOwner;
                currentOwner = declaringOwner;
                try {
                    const children: unknown = render();
                    if (templating > 0) {
                        return children;
                    }
                    value = children;
                    rendered = true;
                }
                finally {
                    currentOwner = parent;
                }
                return value;
            }
        });
    }

    const instances: ClientInstanceEntry[] = root.instances;
    const vendorPackages: string[] = [];

    const runtime: RenderServerRuntime = {
        raw,
        child: renderChild,
        attr,
        spread: spreadAttributes,
        selectOption,
        environment,
        on,
        text,
        bindings: root.bindings,
        useRef,
        useRefs,
        refs,
        useState,
        states: root.states,
        mark,
        markProp,
        project: projectValue,
        handlers,
        instances,
        vendorPackages,
        clientProps,
        provideContext,
        useContext,
        input,
        forward,
        region,
        hole: (value: unknown): Raw => raw(`<!--[-->${renderChild(value)}<!--]-->`),
        range,
        when,
        rows,
        read,
        opaque,
        part,
        partValue: (compute: () => unknown, state: boolean): PartProp => ({ [PART_PROP]: true, kind: state ? 'state' : 'value', compute }),
        partFunction: (compute: () => unknown): PartProp => ({ [PART_PROP]: true, kind: 'function', compute }),
        regions: root.regions,
        registry: root,
        parts,
        templates,
        templatesOf: (owner: number) => templateIds.get(owner),
        useInput,
        useWritableInput,
        inputs: root.inputs,
        collect,
        collected,
        // Registers a client instance (when the component has client behavior), then delegates to
        // its server render, handing it this same runtime so nested renders share the registries.
        component: (compiled: CompiledComponent | string, handed: Record<string, unknown>, children?: () => unknown): Raw => {
            // A capitalized identifier holding a tag name (`const Tag = 'h1'; <Tag/>`) looks exactly
            // like a component to the compiler, so the element case is resolved here.
            if (typeof compiled === 'string') {
                return renderDynamicElement(compiled, children ? withLazyChildren(handed, children) : handed, on);
            }
            const props: Record<string, unknown> = withInputsTaken(compiled, handed);
            const withChildren: Record<string, unknown> = children ? withLazyChildren(props, children) : props;
            for (const packageName of compiled.clientPackages ?? []) {
                if (!vendorPackages.includes(packageName)) {
                    vendorPackages.push(packageName);
                }
            }
            const { code, setupName, referencedProps, propShapes, stateShapes, referencedHooks, referencedTranslations } = compiled.client;
            const owner: number = ++ownerCounter;
            if (code && setupName) {
                current().instances.push({
                    name: compiled.name,
                    setupName,
                    code,
                    referencedHooks,
                    referencedTranslations,
                    stateShapes,
                    owner,
                    // Deliberately the original props: reading the lazy children here would render
                    // them before the component runs, which is exactly what they are lazy to avoid.
                    // Rendered markup never reaches the page as a prop anyway.
                    props: pickSerializable(props, referencedProps, propShapes ?? {}, markHandlerProp)
                });
            }
            // Handlers and client props declared while this component renders belong to this instance.
            const parent: number = currentOwner;
            const parentComponent: string = currentComponent;
            currentOwner = owner;
            currentComponent = compiled.name;
            // Anything this component provides is scoped to its render: its children are forced while
            // building the returned markup, so by the time render returns every descendant has read
            // what it needed and the frames can be dropped.
            const contextDepth: number = contextStack.length;
            try {
                return compiled.render(withChildren, runtime);
            }
            finally {
                currentOwner = parent;
                currentComponent = parentComponent;
                contextStack.length = contextDepth;
            }
        }
    };

    /**
     * The props a component renders with: a value following a state in a prop it cannot follow is reported, and handed
     * in as the value it has now.
     * @param compiled - The component.
     * @param props - The props it is handed.
     * @returns The props.
     */
    function withInputsTaken(compiled: CompiledComponent, props: Record<string, unknown>): Record<string, unknown> {
        const refused: string[] = Object.keys(props)
            .filter(name => isInputMarker(props[name]) && compiled.inputProps?.includes(name) !== true);
        if (refused.length === 0) {
            return props;
        }
        const taken: Record<string, unknown> = { ...props };
        for (const name of refused) {
            reportRenderMistake(environment, `'${name}' of '${compiled.name}' is handed a value that follows a state, and `
                + `'${compiled.name}' uses it where the page cannot follow it. Forward it to an element or a component as it is, `
                + `or read it with useInput(${name}).`);
            const marker: unknown = props[name];
            taken[name] = isInputMarker(marker) ? marker.value : marker;
        }
        return taken;
    }

    return runtime;
}

/**
 * Selects the named props whose values can reach the page, dropping functions and rendered markup so
 * nothing unintended (or unserializable) reaches the browser.
 *
 * A client-prop reference is kept: it is not the function itself but the pointer the page uses to
 * pick up the one the declaring parent's setup builds. A handler the client reads becomes such a
 * reference. Every other value is narrowed to what the client reads from it.
 * @param props - All props passed to the component.
 * @param names - The props the client references.
 * @param shapes - What the client reads from each prop.
 * @param markHandlerProp - Makes the reference for a handler the client reads.
 * @returns The serializable subset.
 */
function pickSerializable(
    props: Record<string, unknown>,
    names: ReferencedProps,
    shapes: Record<string, AccessShape>,
    markHandlerProp: (marker: HandlerMarker) => ClientPropMarker | PartReference
): Record<string, unknown> {
    const selected: Record<string, unknown> = {};
    for (const name of resolveReferencedKeys(props, names)) {
        const value: unknown = props[name];
        if (!(name in props) || typeof value === 'function' || isRaw(value)) {
            continue;
        }
        if (isHandlerMarker(value)) {
            selected[name] = markHandlerProp(value);
            continue;
        }
        // a ref crosses as the entry it stamps, which the page makes a handle of
        selected[name] = isClientPropMarker(value) || isRefMarker(value) ? value : projectValue(value, shapes[name] ?? 'whole');
    }
    return selected;
}

/**
 * The keys of the props the client references.
 * @param props - All props passed to the component.
 * @param names - The props the client references.
 * @returns The keys. `children` is never one of every key, since reading it renders it.
 */
export function resolveReferencedKeys(props: Record<string, unknown>, names: ReferencedProps): string[] {
    if (Array.isArray(names)) {
        return names;
    }
    const except: string[] = names === 'all' ? [] : names.allExcept;
    return Object.keys(props).filter(name => name !== 'children' && !except.includes(name));
}

/**
 * An empty registry, for the page, a part or a template.
 * @returns The registry.
 */
function createRegistry(): RenderRegistry {
    return {
        instances: [],
        handlers: [],
        bindings: [],
        regions: [],
        clientProps: [],
        refs: [],
        states: [],
        inputs: [],
        partBindings: [],
        partHandlers: []
    };
}

/**
 * The state a value is, when it is one: an object with a value.
 * @param value - The value.
 * @returns The state, or undefined.
 */
function toState(value: unknown): ServerState | undefined {
    return typeof value === 'object' && value !== null && 'value' in value ? value : undefined;
}

/**
 * Whether a value is a prop of a part, created by `partValue` or `partFunction`.
 * @param value - The value to test.
 * @returns True for one.
 */
function isPartProp(value: unknown): value is PartProp {
    return typeof value === 'object' && value !== null && PART_PROP in value && value[PART_PROP] === true;
}

/**
 * Whether a value is a reference to a prop of a part.
 * @param value - The value to test.
 * @returns True for one.
 */
export function isPartReference(value: unknown): value is PartReference {
    return typeof value === 'object' && value !== null && PART_REFERENCE in value && value[PART_REFERENCE] === true;
}

/**
 * Whether a value is a value following a state, created by `input`.
 * @param value - The value to test.
 * @returns True for one.
 */
export function isInputMarker(value: unknown): value is InputMarker {
    return typeof value === 'object' && value !== null && INPUT_MARKER in value && value[INPUT_MARKER] === true;
}

/**
 * Whether a value is a client-prop reference created by `markProp`.
 * @param value - The value to test.
 * @returns True for a client-prop reference.
 */
export function isClientPropMarker(value: unknown): value is ClientPropMarker {
    return typeof value === 'object' && value !== null && CLIENT_PROP_MARKER in value && value[CLIENT_PROP_MARKER] === true;
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