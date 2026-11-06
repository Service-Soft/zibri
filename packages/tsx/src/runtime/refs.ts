/**
 * Marks the element a ref can be put on. It exists in the types only: what a ref's type says it holds has to
 * be something the element is, so a `Ref<HTMLElement>` fits a `<dialog>` and a `Ref<HTMLInputElement>` does
 * not.
 */
declare const REF_ELEMENT: unique symbol;

/**
 * What can be put on an element of type `E` with `ref`.
 */
export type RefTarget<E> = {
    /**
     * The elements the ref can hold, in the types only.
     */
    readonly [REF_ELEMENT]: (element: E) => void
};

/**
 * The handle `useRef` returns: the element it was put on, read in the browser.
 */
export type Ref<T> = RefTarget<NonNullable<T>> & {
    /**
     * The element. Read it in client code, such as `onClient` or a handler.
     */
    readonly current: T
};

/**
 * The handle `useRefs` returns: every element it was put on, in document order, read in the browser.
 */
export type Refs<T> = RefTarget<T> & {
    /**
     * The elements. Read them in client code, such as `onClient` or a handler.
     */
    readonly current: T[]
};

/**
 * Whether a ref needs an element.
 */
export type RefOptions = {
    /**
     * `false` for a ref that may stay on no element, whose `current` is then `undefined`. A ref is
     * required unless it says otherwise.
     */
    required: boolean
};

/**
 * Gives client code the element it is put on with `ref`. Call it at the top of a component, as
 * `const dialog = useRef<HTMLDialogElement>();`, and put it on one element: `<dialog ref={dialog}>`.
 * @returns The handle, whose `current` is the element.
 * @throws When called anywhere but in the body of a compiled tsx component.
 */
export function useRef<T extends Element>(): Ref<T>;
/**
 * Gives client code the element it is put on with `ref`.
 * @param options - `{ required: true }`, the same as passing nothing.
 * @returns The handle, whose `current` is the element.
 */
export function useRef<T extends Element>(options: { required: true }): Ref<T>;
/**
 * Gives client code the element it is put on with `ref`, or `undefined` when it is on none.
 * @param options - `{ required: false }`.
 * @returns The handle, whose `current` is the element or `undefined`.
 */
export function useRef<T extends Element>(options: { required: false }): Ref<T | undefined>;
/**
 * What a call the compiler never saw runs.
 * @throws Always, as there is no render to create a ref in.
 */
// the overloads above are what a template calls; the body takes nothing, as it only refuses the call
export function useRef(): never {
    throw new Error('useRef was called outside a tsx component. Call it at the top of a component in a .tsx template.');
}

/**
 * Gives client code every element it is put on with `ref`, such as the rows of a list. Call it at the top
 * of a component, as `const rows = useRefs<HTMLLIElement>();`.
 * @returns The handle, whose `current` is the elements, in document order.
 * @throws When called anywhere but in the body of a compiled tsx component.
 */
export function useRefs<T extends Element>(): Refs<T>;
/**
 * What a call the compiler never saw runs.
 * @throws Always, as there is no render to create a ref in.
 */
// the overload above is what a template calls; the body takes nothing, as it only refuses the call
export function useRefs(): never {
    throw new Error('useRefs was called outside a tsx component. Call it at the top of a component in a .tsx template.');
}

/**
 * Marks an object as a ref of the server render.
 */
export const REF_MARKER: unique symbol = Symbol.for('zibri-tsx.ref-marker');

/**
 * What the page knows of a ref: everything its handle needs in the browser.
 */
export type RefEntry = {
    /**
     * The id the elements it is put on are stamped with, unique across the page.
     */
    id: string,
    /**
     * The name of the variable it is assigned to, which names it in a message.
     */
    name: string,
    /**
     * The component that created it, which names it in a message.
     */
    component: string,
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
 * A ref while the server renders: the entry, which `ref` stamps on an element, travelling through props
 * like any other value.
 */
export type RefMarker = {
    /**
     * Marks this object as a ref.
     */
    readonly [REF_MARKER]: true,
    /**
     * The ref.
     */
    readonly entry: RefEntry
};

/**
 * Whether a value is a ref of the server render.
 * @param value - The value.
 * @returns True for a ref.
 */
export function isRefMarker(value: unknown): value is RefMarker {
    return typeof value === 'object' && value !== null && REF_MARKER in value && value[REF_MARKER] === true;
}
