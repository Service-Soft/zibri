import { Newable } from '../types/newable.type.ts';
import { copyClassProperties } from './utilities/copy-class-properties.function.ts';

// eslint-disable-next-line jsdoc-js/require-returns
/**
 * Defines a omit class based on the provided class.
 * @param Base - The base class that should be made into a omit class.
 * @param keys - The keys that should be omitted.
 */
export function OmitClass<T, K extends keyof T>(
    Base: Newable<T>,
    keys: readonly K[]
): Newable<Omit<T, K>> {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    class OmitClass {}
    copyClassProperties(OmitClass, Base, keys as K[]);
    return OmitClass as Newable<Omit<T, K>>;
}