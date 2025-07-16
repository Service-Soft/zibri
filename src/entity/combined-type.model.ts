import { Newable } from '../types';
import { MetadataUtilities } from '../utilities';
import { PropertyMetadata } from './decorators';

// eslint-disable-next-line jsdoc/require-jsdoc
type UnionToIntersection<U> =
  // eslint-disable-next-line typescript/no-explicit-any
    (U extends any ? (k: U) => void : never) extends (k: infer I) => void
        ? I
        : never;

// eslint-disable-next-line jsdoc/require-jsdoc
type IntersectionInstances<T extends Newable<unknown>[]> =
    UnionToIntersection<InstanceType<T[number]>>;

// eslint-disable-next-line jsdoc/require-returns
/**
 * Defines an combined class based on the provided classes.
 * @param bases - The base classes that should be made into a single combined class.
 */
export function CombinedType<Bases extends Newable<unknown>[]>(
    ...bases: Bases
): Newable<IntersectionInstances<Bases>> {
    const [First] = bases;
    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/no-explicit-any
    class IntersectionClass extends (First as any) {}

    // merge property‐metadata from each base, in order
    const merged: Record<string, PropertyMetadata> = {};
    for (const Base of bases) {
        const meta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(Base);
        Object.assign(merged, meta);
    }
    MetadataUtilities.setModelProperties(IntersectionClass, merged);

    return IntersectionClass as Newable<IntersectionInstances<Bases>>;
}