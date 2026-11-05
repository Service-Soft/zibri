import { RequiredPropertyValue } from './models/base-property-metadata.model';

/**
 * The `required` functions {@link resolveRequiredWhenGiven} made.
 */
const requiredWhenGiven: WeakSet<Function> = new WeakSet<Function>();

/**
 * A `required` for a property that may be left out, but takes no null when it is given: required
 * exactly when the object it is on holds the key.
 * @param key - The property.
 * @returns The `required` of the property.
 */
export function resolveRequiredWhenGiven(key: string): RequiredPropertyValue {
    const required: RequiredPropertyValue = (data: unknown) => typeof data === 'object' && data != undefined && Object.hasOwn(data, key);
    requiredWhenGiven.add(required);
    return required;
}

/**
 * Whether a `required` is one made by {@link resolveRequiredWhenGiven}, which never takes null.
 * @param required - The `required` of a property.
 * @returns True for such a function.
 */
export function isRequiredWhenGiven(required: RequiredPropertyValue): boolean {
    return typeof required === 'function' && requiredWhenGiven.has(required);
}