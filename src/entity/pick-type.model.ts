import { Newable } from '../types';
import { MetadataUtilities } from '../utilities';
import { PropertyMetadata } from './decorators';

export function PickType<T, K extends keyof T>(
    Base: Newable<T>,
    keys: readonly K[]
): Newable<Pick<T, K>> {
    // eslint-disable-next-line typescript/no-explicit-any
    class PickClass extends (Base as any) {}

    const original: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(Base);
    const filtered: Record<string, PropertyMetadata> = {};
    for (const [prop, meta] of Object.entries(original)) {
        if (keys.includes(prop as K)) {
            filtered[prop] = meta;
        }
    }
    MetadataUtilities.setModelProperties(PickClass, filtered);

    return PickClass as Newable<Pick<T, K>>;
}