import { TsxComponent } from '../email/define-email-component';
import { CompiledComponent, createServerRuntime, Raw, renderChild, RenderServerRuntime } from '../runtime/server-runtime';

/**
 * Mounts an email component, deferring its children so they render inside its frame - the same lazy
 * wiring the compiler emits, which is what lets a parent provide layout its children read.
 */
export type Mount = <P>(component: TsxComponent<P>, props: P, children?: () => unknown) => Raw;

/**
 * Renders an email component tree to HTML. The tree is built with the given `mount`, so nested
 * `mount` calls in a `children` thunk run only when their parent reads them.
 * @param build - Builds the tree, using `mount` to place components.
 * @returns The rendered HTML.
 */
export function renderEmail(build: (mount: Mount) => Raw): string {
    const runtime: RenderServerRuntime = createServerRuntime();
    // The single inherent compiled-object-to-component cast, kept in one place - an email component
    // is a compiled object at runtime, typed as a JSX component for authoring.
    const mount: Mount = <P>(component: TsxComponent<P>, props: P, children?: () => unknown): Raw => {
        return runtime.component(component as unknown as CompiledComponent, props as Record<string, unknown>, children);
    };
    return renderChild(build(mount));
}