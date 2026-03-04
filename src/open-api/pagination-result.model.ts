import { Property } from '../entity/decorators/property.decorator';
import { Newable } from '../types/newable.type';

/**
 * Type of a pagination result, consisting of the items from the current page and the total amount of items.
 */
export type PaginationResult<T> = {
    /**
     * The items of the current page.
     */
    items: T[],
    /**
     * The total amount of items.
     */
    totalAmount: number
};

// eslint-disable-next-line jsdoc/require-returns
/**
 * A pagination result class, consisting of the items from the current page and the total amount of items.
 * @param itemClass - The pagination item class.
 */
export function PaginationResultClass<T>(itemClass: Newable<T>): Newable<PaginationResult<T>> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    class PaginationResultClass implements PaginationResult<T> {
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.array({ items: { type: 'object', cls: () => itemClass }, description: 'the paginated items' })
        items!: T[];
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.number({ description: 'the total amount of items' })
        totalAmount!: number;
    }

    return PaginationResultClass;
}