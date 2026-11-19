import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { PropertyMetadata } from './decorators/property.decorator';
import { resolveRequiredWhenGiven } from './required-when-given.function';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Defines a partial class based on the provided class.
 * @param Base - The base class that should be made into a partial.
 */
export function PartialClass<T>(
    Base: Newable<T>
): Newable<Partial<T>> {
    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/no-explicit-any
    class Partialized extends (Base as any) {}
    // the name an xml body or document of the class is read and written under, unless a class extending it names one
    Object.defineProperty(Partialized, 'name', { value: 'PartialClass' });

    const original: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(Base);
    const partialMeta: Record<string, PropertyMetadata> = {};
    for (const [prop, meta] of ObjectUtilities.entries(original)) {
        // a property the base requires may be left out, but given it is given a value: null where the
        // base requires one is a value the row the base describes cannot hold
        partialMeta[prop] = { ...meta, required: meta.required === false ? false : resolveRequiredWhenGiven(prop) };
    }
    MetadataUtilities.setModelProperties(Partialized, partialMeta);
    MetadataUtilities.stopInheritingCustomValidations(Partialized);

    return Partialized as Newable<Partial<T>>;
}