import { OmitClass } from './omit-class.model';
import { Newable } from '../types/newable.type';
import { getAllClassKeys, getAllPrototypeKeys } from './utilities/copy-class-properties.function';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Defines a pick class based on the provided class.
 * @param Base - The base class that should be made into a pick class.
 * @param keys - The keys that should be picked from the base class.
 */
export function PickClass<T, K extends keyof T>(
    Base: Newable<T>,
    keys: readonly K[]
): Newable<Pick<T, K>> {
    const allKeys: (keyof T)[] = [...getAllClassKeys(Base, []), ...getAllPrototypeKeys(Base, [])];
    const omitKeys: (keyof T)[] = allKeys.filter(k => !keys.includes(k as K));
    return OmitClass(Base, omitKeys) as Newable<Pick<T, K>>;
}