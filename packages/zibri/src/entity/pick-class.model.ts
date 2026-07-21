import { OmitClass } from './omit-class.model';
import { Newable } from '../types/newable.type';
import { getAllClassKeys, getAllPrototypeKeys } from './utilities/copy-class-properties.function';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';

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
    // @Property-decorated fields never become real prototype/class property descriptors (the decorator
    // only registers them in MetadataUtilities), so getAllClassKeys/getAllPrototypeKeys alone can't see
    // them — the model properties registry needs to be included too.
    const modelPropertyKeys: (keyof T)[] = ObjectUtilities.keys(
        MetadataUtilities.getModelProperties(Base)
    ) as (keyof T)[];
    const allKeys: (keyof T)[] = [...new Set([...getAllClassKeys(Base, []), ...getAllPrototypeKeys(Base, []), ...modelPropertyKeys])];
    const omitKeys: (keyof T)[] = allKeys.filter(k => !keys.includes(k as K));
    return OmitClass(Base, omitKeys) as Newable<Pick<T, K>>;
}