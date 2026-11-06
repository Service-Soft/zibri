import { State } from './state';

/**
 * A value as `useInput` hands it out: read only, an array, a map or a set included.
 */
export type ReadonlyValue<T> = T extends (infer Item)[]
    ? readonly Item[]
    : T extends Map<infer Key, infer Entry>
        ? ReadonlyMap<Key, Entry>
        : T extends Set<infer Item>
            ? ReadonlySet<Item>
            : T extends object ? Readonly<T> : T;

/**
 * The handle `useInput` returns: `value` reads what the component was handed, and follows the state it was derived
 * from in a component above.
 */
export type Input<T> = {
    /**
     * The current value.
     */
    readonly value: ReadonlyValue<T>
};

/**
 * Reads a value a component is handed, such as a prop, and follows it when a component above derived it from a
 * state. Call it at the top of a component, as `const text = useInput(props.text);`.
 *
 * The argument runs on the server while it renders, like the argument of `useState`, so a context reaches the page
 * as `useInput(useContext(Snapshots))`. A value derived from no state never changes.
 * @param value - The value, such as a prop.
 * @returns The handle, read only.
 * @throws When called anywhere but in the body of a compiled tsx component.
 */
export function useInput<T>(value: T): Input<T>;
/**
 * What a call the compiler never saw runs.
 * @throws Always, as there is no render to read a value in.
 */
// the overload above is what a template calls; the body takes nothing, as it only refuses the call
export function useInput(): never {
    throw new Error('useInput was called outside a tsx component. Call it at the top of a component in a .tsx template.');
}

/**
 * Takes a state a component is handed by a component above, which this one may write: a two-way binding. Call it at
 * the top of a component, as `const text = useWritableInput(props.value);`.
 * @param state - The state, handed down as it is, such as `value={email}`.
 * @returns The state.
 * @throws When called anywhere but in the body of a compiled tsx component.
 */
export function useWritableInput<T>(state: State<T>): State<T>;
/**
 * What a call the compiler never saw runs.
 * @throws Always, as there is no render to take a state in.
 */
// the overload above is what a template calls; the body takes nothing, as it only refuses the call
export function useWritableInput(): never {
    throw new Error('useWritableInput was called outside a tsx component. Call it at the top of a component in a .tsx template.');
}
