import { Newable } from '../types';
import { copyClassProperties } from './utilities/copy-class-properties.function';

// eslint-disable-next-line jsdoc/require-jsdoc
type UnionToIntersection<U>
// eslint-disable-next-line typescript/no-explicit-any
    = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
        ? I
        : never;

// eslint-disable-next-line jsdoc/require-jsdoc
type IntersectionInstances<T extends Newable<unknown>[]>
    = UnionToIntersection<InstanceType<T[number]>>;

// eslint-disable-next-line jsdoc/require-returns
/**
 * Defines an combined class based on the provided classes.
 * @param bases - The base classes that should be made into a single combined class.
 */
export function IntersectionClass<Bases extends Newable<unknown>[]>(
    ...bases: Bases
): Newable<IntersectionInstances<Bases>> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    class CombinedClass {}
    // merge metadata from each base, in order
    for (const Base of bases) {
        copyClassProperties(CombinedClass, Base, []);
    }

    return CombinedClass as Newable<IntersectionInstances<Bases>>;
}