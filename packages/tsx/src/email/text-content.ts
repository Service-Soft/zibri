import { RenderServerRuntime } from '../runtime/server-runtime.ts';

/**
 * The plain text of a component's children. A string child is taken as-is (so head text is recorded
 * raw, to be escaped or emitted verbatim by whoever uses it); anything else is rendered normally.
 * @param children - The children value.
 * @param $ssr - The render runtime.
 * @returns The text content.
 */
export function textContent(children: unknown, $ssr: RenderServerRuntime): string {
    return typeof children === 'string' ? children : $ssr.child(children);
}