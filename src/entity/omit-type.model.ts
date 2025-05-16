import { PropertyMetadata } from '../entity';
import { Newable } from '../types';
import { MetadataUtilities } from '../utilities';

export function OmitType<T, K extends keyof T>(
    Base: Newable<T>,
    keys: readonly K[]
): Newable<Omit<T, K>> {
    // eslint-disable-next-line typescript/no-explicit-any
    class OmitClass extends (Base as any) {}

    const original: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(Base);
    const filtered: Record<string, PropertyMetadata> = {};
    for (const [prop, meta] of Object.entries(original)) {
        if (!keys.includes(prop as K)) {
            filtered[prop] = meta;
        }
    }
    MetadataUtilities.setModelProperties(OmitClass, filtered);

    return OmitClass as Newable<Omit<T, K>>;
}