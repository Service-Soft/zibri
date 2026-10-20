/**
 * The part of `Reflect` that `reflect-metadata` adds, which is only there once that has been loaded.
 */
type ReflectMetadata = Partial<Pick<typeof Reflect, 'metadata'>>;

/**
 * Builds the decorator that records one piece of design time type information, the way
 * TypeScript's own emit does.
 * @param key - The metadata key, such as `design:type`.
 * @param value - What the compiler recorded under it.
 * @returns The decorator, or undefined when `reflect-metadata` has not been loaded.
 */
function decorateMetadata(key: string, value: unknown): ReturnType<typeof Reflect.metadata> | undefined {
    const reflect: ReflectMetadata = Reflect;
    return reflect.metadata?.(key, value);
}

// the transformed code imports this as a default export from an es module and requires it from a
// commonjs one, where `require` of an es module hands back the export named "module.exports"
// oxlint-disable-next-line jsdoc-js/require-jsdoc
export { decorateMetadata as default, decorateMetadata as 'module.exports' };
