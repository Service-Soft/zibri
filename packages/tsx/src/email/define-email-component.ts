import { TsxChildren, TsxElement } from '../jsx/jsx.model';
import { CompiledComponent, ComponentClientMeta, Raw, RenderServerRuntime } from '../runtime/server-runtime';

/**
 * A component usable in JSX. At runtime a zibri-tsx compiled component is a plain object, but tsx
 * type checks it as a function from props to an element - the same benign gap the compiled page
 * templates rely on.
 *
 * Every email component may be given children: MJML's model is entirely nesting, and which children
 * are actually legal is enforced at compile time by the nesting gate, not by this type.
 */
export type TsxComponent<T = {}> = (props: T & {
    /**
     * The nested content.
     */
    children?: TsxChildren
}) => TsxElement;

/**
 * An email component always accepts children, since MJML's model is entirely about nesting.
 */
export type EmailProps<T> = T & {
    /**
     * The nested content.
     */
    children?: TsxChildren
};

/**
 * The render function of an email component: it builds trusted HTML directly, so it takes the typed
 * props and the per-render runtime and returns a {@link Raw} fragment.
 */
export type EmailRender<T> = (props: EmailProps<T>, $ssr: RenderServerRuntime) => Raw;

/**
 * The client metadata every email component shares: none. Emails are server-rendered to a static
 * document with no script, so there is never a client setup, referenced prop or `?client` package.
 */
const NO_CLIENT_BEHAVIOR: ComponentClientMeta = {
    code: undefined,
    setupName: undefined,
    referencedProps: [],
    referencedHooks: [],
    referencedTranslations: { sources: [], complete: true }
};

/**
 * Builds a framework-owned email component from a hand-written render function. Keeps the one
 * inherent compiled-object-to-component cast in a single place, and fills in the empty client
 * metadata every email shares.
 * @param name - The component name, used in diagnostics.
 * @param render - Builds the component's HTML from its props and the render runtime.
 * @returns The component, typed for use in JSX.
 */
export function defineEmailComponent<T>(name: string, render: EmailRender<T>): TsxComponent<T> {
    const compiled: CompiledComponent = {
        name,
        render: (props: Record<string, unknown>, $ssr: RenderServerRuntime) => render(props as EmailProps<T>, $ssr),
        client: NO_CLIENT_BEHAVIOR,
        clientPackages: []
    };
    return compiled as unknown as TsxComponent<T>;
}