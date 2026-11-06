/**
 * The handle `useState` returns: `value` reads the state, and assigning it writes the state. In the browser a
 * write updates every part of the page that reads the state.
 */
export type State<T> = {
    /**
     * The current value. Assign a new value to change it, rather than changing the value itself.
     */
    value: T
};

/**
 * Creates a state of the component, which client code reads and writes, and the markup follows. Call it at the
 * top of a component, as `const count = useState(0);`.
 *
 * The argument runs on the server while it renders, and the page gets what it returns, narrowed to what client
 * code reads of it: `useState(MaskUtilities.mask(email))` hands the browser the masked text.
 * @param initial - The value it starts with.
 * @returns The handle.
 * @throws When called anywhere but in the body of a compiled tsx component.
 */
export function useState<T>(initial: T): State<T>;
/**
 * What a call the compiler never saw runs.
 * @throws Always, as there is no render to create a state in.
 */
// the overload above is what a template calls; the body takes nothing, as it only refuses the call
export function useState(): never {
    throw new Error('useState was called outside a tsx component. Call it at the top of a component in a .tsx template.');
}
