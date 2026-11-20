import { Newable } from '../types/newable.type';
import { ClassPropertyUtilities } from './utilities/class-property.utilities';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Defines a omit class based on the provided class.
 * @param Base - The base class that should be made into a omit class.
 * @param keys - The keys that should be omitted.
 */
export function OmitClass<T, K extends keyof T>(
    Base: Newable<T>,
    keys: readonly K[]
): Newable<Omit<T, K>> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    class Omitted {}
    // the name an xml body or document of the class is read and written under, unless a class extending it names one
    Object.defineProperty(Omitted, 'name', { value: 'OmitClass' });
    ClassPropertyUtilities.copy(Omitted, Base, keys as K[]);
    return Omitted as Newable<Omit<T, K>>;
}