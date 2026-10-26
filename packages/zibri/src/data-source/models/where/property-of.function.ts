import { PropertyReference } from './property-reference.model';

/**
 * Names another property of the same row, for a filter to compare a property with:
 * `{ endsAt: { after: propertyOf('startsAt') } }` matches the rows that end after they start.
 *
 * It goes where a comparison takes its value - `after`, `before`, `afterOrOn` and `beforeOrOn` of a
 * date, `greaterThan`, `greaterThanEquals`, `lesserThan` and `lesserThanEquals` of a number - and
 * names a property of the same entity holding the same kind of value, which the filter it is written
 * in types. A row holding no value on either side matches no comparison.
 * @param property - The property to compare with.
 * @returns The reference.
 */
export function propertyOf<K extends string>(property: K): PropertyReference<K> {
    // the one cast that may produce a PropertyReference. The mark says it was made here, and this is
    // the only place that can know it was
    return { property } as PropertyReference<K>;
}
