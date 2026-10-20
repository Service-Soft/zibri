import { HeadChannel } from './head-channels.ts';
import { RenderServerRuntime } from '../runtime/server-runtime.ts';

/**
 * One document's declared defaults: a global set and per-component sets.
 */
export type Defaults = {
    /**
     * Applied to every component.
     */
    all: Record<string, string>,
    /**
     * Applied to a named component.
     */
    defaults: Record<string, Record<string, string>>
};

/**
 * The merged defaults every `MjAttributes` in the document declared. Empty when there are none.
 * @param $ssr - The render runtime.
 * @returns The combined global and per-component defaults.
 */
export function documentDefaults($ssr: RenderServerRuntime): Defaults {
    const all: Record<string, string> = {};
    const defaults: Record<string, Record<string, string>> = {};
    for (const blob of $ssr.collected(HeadChannel.attributes)) {
        const parsed: Defaults = JSON.parse(blob) as Defaults;
        Object.assign(all, parsed.all);
        for (const [component, values] of Object.entries(parsed.defaults)) {
            defaults[component] = { ...defaults[component], ...values };
        }
    }
    return { all, defaults };
}

/**
 * Merges the document's declared default attributes under a component's own props. An `MjAttributes`
 * in the head records the defaults; here they fill in any prop the caller left unset, with a
 * per-component default winning over a global one, and an explicit prop winning over both. Returns
 * the props unchanged when nothing was declared, so components behave identically without it.
 *
 * `children` is never read, so a component's lazy children are not forced early.
 * @param $ssr - The render runtime.
 * @param component - The component's name, matching the keys of `MjAttributes.defaults`.
 * @param props - The component's own props.
 * @returns The props with declared defaults filled in.
 */
export function withDefaults<T extends object>($ssr: RenderServerRuntime, component: string, props: T): T {
    const blobs: string[] = $ssr.collected(HeadChannel.attributes);
    if (blobs.length === 0) {
        return props;
    }

    const { all, defaults }: Defaults = documentDefaults($ssr);
    const forComponent: Record<string, string> = defaults[component] ?? {};

    const explicit: Record<string, unknown> = {};
    for (const key of Object.keys(props)) {
        // Reading `children` would force the lazy children before the component establishes its
        // context; it never takes a declared default anyway.
        if (key === 'children') {
            continue;
        }
        const value: unknown = (props as Record<string, unknown>)[key];
        if (value !== undefined) {
            explicit[key] = value;
        }
    }

    return { ...all, ...forComponent, ...explicit } as T;
}