/**
 * The classes of an operation of one method: its frame and its badge.
 */
export type ExplorerMethodClasses = {
    frame: string,
    badge: string
};

// written out whole, as Tailwind finds a class only where it is written
const METHOD_CLASSES: Record<string, ExplorerMethodClasses> = {
    get: { frame: 'border-[#61affe] bg-[#61affe]/10', badge: 'bg-[#61affe]' },
    post: { frame: 'border-[#49cc90] bg-[#49cc90]/10', badge: 'bg-[#49cc90]' },
    put: { frame: 'border-[#fca130] bg-[#fca130]/10', badge: 'bg-[#fca130]' },
    patch: { frame: 'border-[#50e3c2] bg-[#50e3c2]/10', badge: 'bg-[#50e3c2]' },
    delete: { frame: 'border-[#f93e3e] bg-[#f93e3e]/10', badge: 'bg-[#f93e3e]' },
    // a websocket event a client emits, and one it listens to
    emit: { frame: 'border-[#49cc90] bg-[#49cc90]/10', badge: 'bg-[#49cc90]' },
    on: { frame: 'border-[#61affe] bg-[#61affe]/10', badge: 'bg-[#61affe]' }
};

/**
 * The classes of an operation of a method.
 * @param method - The method, such as `get`, or `emit` and `on` for a websocket event.
 * @returns The classes, purple for a method without colors of its own, such as `options`.
 */
export function resolveMethodClasses(method: string): ExplorerMethodClasses {
    return METHOD_CLASSES[method] ?? { frame: 'border-[#9012fe] bg-[#9012fe]/10', badge: 'bg-[#9012fe]' };
}