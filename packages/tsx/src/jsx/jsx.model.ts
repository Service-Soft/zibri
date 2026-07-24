import { Raw } from '../runtime/server-runtime';

/**
 * What a jsx expression evaluates to.
 *
 * Templates are compiled to html producing functions, so an element is a pre-rendered, trusted html
 * fragment rather than a virtual dom node.
 */
export type TsxElement = Raw;

/**
 * A single value that may be placed inside an element.
 */
export type TsxChild = TsxElement | string | number | bigint | boolean | undefined;

/**
 * Anything that may be placed inside an element, including nested arrays produced by `.map`.
 */
export type TsxChildren = TsxChild | TsxChildren[];

/**
 * An inline style object. Camel cased properties are converted to their dashed html form, custom
 * properties (`--name`) are passed through unchanged.
 */
export type StyleObject = Record<string, string | number | undefined>;

/**
 * An event whose `currentTarget` is narrowed to the element the handler is attached to.
 */
export type TargetedEvent<T extends EventTarget, E extends Event = Event> = Omit<E, 'currentTarget'> & {
    /**
     * The element the handler is attached to.
     */
    readonly currentTarget: T
};

/**
 * A handler for an event on the given element.
 */
export type EventHandler<T extends EventTarget, E extends Event = Event> = (event: TargetedEvent<T, E>) => unknown;

/**
 * Marks html as trusted so it is written out verbatim instead of being escaped.
 */
export type DangerousHtml = {
    /**
     * The trusted html.
     */
    __html: string
};

/**
 * The event handler props available on every element.
 */
export type EventAttributes<T extends EventTarget> = {
    /**
     * Runs when the element is clicked.
     */
    onClick?: EventHandler<T, MouseEvent>,
    /**
     * Runs when the element is double clicked.
     */
    onDblClick?: EventHandler<T, MouseEvent>,
    /**
     * Runs when a mouse button is pressed on the element.
     */
    onMouseDown?: EventHandler<T, MouseEvent>,
    /**
     * Runs when a mouse button is released on the element.
     */
    onMouseUp?: EventHandler<T, MouseEvent>,
    /**
     * Runs when the pointer enters the element.
     */
    onMouseEnter?: EventHandler<T, MouseEvent>,
    /**
     * Runs when the pointer leaves the element.
     */
    onMouseLeave?: EventHandler<T, MouseEvent>,
    /**
     * Runs when the pointer moves over the element.
     */
    onMouseMove?: EventHandler<T, MouseEvent>,
    /**
     * Runs when the pointer moves onto the element or one of its children.
     */
    onMouseOver?: EventHandler<T, MouseEvent>,
    /**
     * Runs when the pointer moves off the element or one of its children.
     */
    onMouseOut?: EventHandler<T, MouseEvent>,
    /**
     * Runs when the right mouse button opens a context menu on the element.
     */
    onContextMenu?: EventHandler<T, MouseEvent>,
    /**
     * Runs when the wheel is turned over the element.
     */
    onWheel?: EventHandler<T, WheelEvent>,
    /**
     * Runs when a key is pressed down while the element has focus.
     */
    onKeyDown?: EventHandler<T, KeyboardEvent>,
    /**
     * Runs when a key is released while the element has focus.
     */
    onKeyUp?: EventHandler<T, KeyboardEvent>,
    /**
     * Runs while the value of an input element is being edited.
     */
    onInput?: EventHandler<T, Event>,
    /**
     * Runs when the value of an input element was changed.
     */
    onChange?: EventHandler<T, Event>,
    /**
     * Runs when a form is submitted.
     */
    onSubmit?: EventHandler<T, SubmitEvent>,
    /**
     * Runs when a form is reset.
     */
    onReset?: EventHandler<T, Event>,
    /**
     * Runs when the element receives focus.
     */
    onFocus?: EventHandler<T, FocusEvent>,
    /**
     * Runs when the element loses focus.
     */
    onBlur?: EventHandler<T, FocusEvent>,
    /**
     * Runs when the element is scrolled.
     */
    onScroll?: EventHandler<T, Event>,
    /**
     * Runs when content is copied from the element.
     */
    onCopy?: EventHandler<T, ClipboardEvent>,
    /**
     * Runs when content is cut from the element.
     */
    onCut?: EventHandler<T, ClipboardEvent>,
    /**
     * Runs when content is pasted into the element.
     */
    onPaste?: EventHandler<T, ClipboardEvent>,
    /**
     * Runs when a resource of the element finished loading.
     */
    onLoad?: EventHandler<T, Event>,
    /**
     * Runs when a resource of the element failed to load.
     */
    onError?: EventHandler<T, Event>,
    /**
     * Runs when a details or dialog element is toggled.
     */
    onToggle?: EventHandler<T, Event>
};

/**
 * The props available on every html element.
 */
export interface HtmlAttributes<T extends EventTarget = HTMLElement> extends EventAttributes<T> {
    /**
     * Any `data-*` attribute.
     */
    [dataAttribute: `data-${string}`]: unknown,
    /**
     * Any `aria-*` attribute.
     */
    [ariaAttribute: `aria-${string}`]: unknown,
    /**
     * The unique id of the element.
     */
    id?: string,
    /**
     * The css classes of the element.
     */
    class?: string,
    /**
     * The css classes of the element, rendered as `class`.
     */
    className?: string,
    /**
     * Inline styles, either as a css string or as an object of properties.
     */
    style?: string | StyleObject,
    /**
     * The advisory tooltip text of the element.
     */
    title?: string,
    /**
     * The language of the element's content.
     */
    lang?: string,
    /**
     * The text direction of the element's content.
     */
    dir?: 'ltr' | 'rtl' | 'auto',
    /**
     * Whether the element is hidden.
     */
    hidden?: boolean,
    /**
     * Whether the element and its content are removed from the accessibility tree and untouchable.
     */
    inert?: boolean,
    /**
     * The accessibility role of the element.
     */
    role?: string,
    /**
     * The position of the element in the tab order.
     */
    tabIndex?: number,
    /**
     * A shortcut key for the element.
     */
    accessKey?: string,
    /**
     * Whether the element's content is editable.
     */
    contentEditable?: boolean | 'true' | 'false' | 'plaintext-only',
    /**
     * Whether the element can be dragged.
     */
    draggable?: boolean,
    /**
     * Whether the element's content should be spell checked.
     */
    spellCheck?: boolean,
    /**
     * Whether the element's content should be translated.
     */
    translate?: 'yes' | 'no',
    /**
     * The name of the shadow dom slot the element is assigned to.
     */
    slot?: string,
    /**
     * The popover behavior of the element.
     */
    popover?: 'auto' | 'manual',
    /**
     * Identifies the element within a list, so loops can be written without warnings.
     */
    key?: string | number,
    /**
     * Sets the element's content from a trusted html string instead of from children.
     */
    dangerouslySetInnerHTML?: DangerousHtml,
    /**
     * The content of the element.
     */
    children?: TsxChildren
}