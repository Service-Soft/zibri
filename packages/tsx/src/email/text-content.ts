import { RenderServerRuntime } from '../runtime/server-runtime';

/**
 * The plain text of a component's children. Text, and text mixed with values, is taken as-is (so head
 * text is recorded raw, to be escaped or emitted verbatim by whoever uses it); anything else is
 * rendered normally.
 * @param children - The children value.
 * @param $ssr - The render runtime.
 * @returns The text content.
 */
export function textContent(children: unknown, $ssr: RenderServerRuntime): string {
    if (typeof children === 'string') {
        return children;
    }
    if (typeof children === 'number' || typeof children === 'bigint') {
        return String(children);
    }
    // `Order for {customer}` arrives as an array, whose parts are text just the same
    return Array.isArray(children) ? children.map(child => textContent(child, $ssr)).join('') : $ssr.child(children);
}