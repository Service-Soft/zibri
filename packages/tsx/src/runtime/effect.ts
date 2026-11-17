import { State } from './state';

/**
 * What an effect runs again for: a state, which it compares by its value, or a function of the component, which it
 * compares by what the function returns.
 */
export type EffectWatched = State<unknown> | (() => unknown);

/**
 * What an effect returns: nothing, or a cleanup that runs before the effect runs again.
 */
export type EffectResult = void | Promise<void> | (() => void);

/**
 * Runs code in the browser once the page has started, and again after each change to what its list names. Call it at
 * the top of a component, as `useEffect(() => { ... }, [count])`.
 *
 * It first runs with the callbacks of `onClient`, in the order they were called. After a change, it runs once the page
 * shows the change, and only when a state of its list holds another value or a function of its list returns another
 * value. A function it returns runs before it runs again. Nothing of it runs on the server.
 * @param effect - The code to run.
 * @param watched - The states and functions of the component it runs again for, written in place.
 * @throws When called anywhere but in the body of a compiled tsx component.
 */
export function useEffect(effect: () => EffectResult, watched: readonly [EffectWatched, ...EffectWatched[]]): void;
/**
 * What a call the compiler never saw runs.
 * @throws Always, as there is no page to run an effect in.
 */
// the overload above is what a template calls; the body takes nothing, as it only refuses the call
export function useEffect(): never {
    throw new Error('useEffect was called outside a tsx component. Call it at the top of a component in a .tsx template.');
}