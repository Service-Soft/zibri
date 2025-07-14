import { Newable } from '../types';
import { MetadataUtilities } from '../utilities';
import { PropertyMetadata } from './decorators';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Defines a partial class based on the provided class.
 * @param Base - The base class that should be made into a partial.
 */
export function PartialType<T>(
    Base: Newable<T>
): Newable<Partial<T>> {
    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/no-explicit-any
    class PartialClass extends (Base as any) {}

    const original: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(Base);
    const partialMeta: Record<string, PropertyMetadata> = {};
    for (const [prop, meta] of Object.entries(original)) {
        partialMeta[prop] = 'required' in meta ? { ...meta, required: false } : meta;
    }
    MetadataUtilities.setModelProperties(PartialClass, partialMeta);

    return PartialClass as Newable<Partial<T>>;
}