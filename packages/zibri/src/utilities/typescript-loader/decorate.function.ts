/**
 * A legacy decorator, as the transformed code hands it over: one for a class, a member or, wrapped by
 * the parameter helper, a constructor or method parameter.
 */
type LegacyDecorator = (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => object | undefined;

/**
 * Applies legacy decorators to a class or one of its members, the way TypeScript's own emit does.
 *
 * The decorators run last to first. A class decorator may hand back a replacement for the class,
 * and a member decorator one for the member's descriptor, which the next decorator then receives.
 * @param decorators - The decorators, in the order they are written. A gap is a metadata decorator
 * that had no `Reflect.metadata` to build it with.
 * @param target - The class, or the prototype or class a member belongs to.
 * @param key - The member, when decorating one.
 * @param descriptor - Null for a method or accessor, whose current descriptor is read; undefined for a field.
 * @returns The class or descriptor the decorators ended with.
 */
function decorate(
    decorators: (LegacyDecorator | undefined)[],
    target: object,
    key?: string | symbol,
    descriptor?: PropertyDescriptor | null
): object | undefined {
    if (key == undefined) {
        let decorated: object = target;
        for (const decorator of [...decorators].reverse()) {
            decorated = decorator?.(decorated) ?? decorated;
        }
        return decorated;
    }

    let current: PropertyDescriptor | undefined = descriptor === null ? Object.getOwnPropertyDescriptor(target, key) : descriptor;
    for (const decorator of [...decorators].reverse()) {
        current = decorator?.(target, key, current) ?? current;
    }
    if (current != undefined) {
        Object.defineProperty(target, key, current);
    }
    return current;
}

// the transformed code imports this as a default export from an es module and requires it from a
// commonjs one, where `require` of an es module hands back the export named "module.exports"
// oxlint-disable-next-line jsdoc-js/require-jsdoc
export { decorate as default, decorate as 'module.exports' };
