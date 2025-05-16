import { Newable } from '../types';
import { MetadataUtilities } from '../utilities';
import { PropertyMetadata } from './decorators';

export function PartialType<T>(
    Base: Newable<T>
): Newable<Partial<T>> {
    // eslint-disable-next-line typescript/no-explicit-any
    class PartialClass extends (Base as any) {}

    const original: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(Base);
    const partialMeta: Record<string, PropertyMetadata> = {};
    for (const [prop, meta] of Object.entries(original)) {
        partialMeta[prop] = { ...meta, required: false };
    }
    MetadataUtilities.setModelProperties(PartialClass, partialMeta);

    return PartialClass as Newable<Partial<T>>;
}