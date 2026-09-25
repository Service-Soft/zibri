import { Property } from '../entity/decorators/property.decorator';
import { XmlRoot } from '../parsing/xml/xml-root.decorator';
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

/**
 * A page read by cursor: the items, how many the filter matches, and where the next page starts.
 */
export type KeysetPage<T> = PaginationResult<T> & {
    /**
     * The cursor to read the next page with, or undefined when this page was the last one.
     *
     * Opaque: it stands for "after this row, in this order, under this filter", and it is only
     * meaningful to the read that produced it. Hand it back as it came.
     */
    nextCursor: string | undefined
};

// eslint-disable-next-line jsdoc/require-returns
/**
 * A pagination result class, consisting of the items from the current page and the total amount of items.
 * @param itemClass - The pagination item class.
 */
export function PaginationResultClass<T>(itemClass: Newable<T>): Newable<PaginationResult<T>> {
    // named here, as an xml document would otherwise be named after this class, whatever the items are
    // eslint-disable-next-line jsdoc/require-jsdoc
    @XmlRoot({ name: 'PaginationResult' })
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

// eslint-disable-next-line jsdoc/require-returns
/**
 * A keyset page class: the items, the total, and the cursor the next page is read with.
 * @param itemClass - The class of the paginated items.
 */
export function KeysetPageClass<T>(itemClass: Newable<T>): Newable<KeysetPage<T>> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    @XmlRoot({ name: 'KeysetPage' })
    class KeysetPageClass implements KeysetPage<T> {
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.array({ items: { type: 'object', cls: () => itemClass }, description: 'the items of this page' })
        items!: T[];
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.number({ description: 'the total amount of items the filter matches' })
        totalAmount!: number;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({
            required: false,
            description: 'pass this back to read the next page, absent when this was the last one'
        })
        nextCursor: string | undefined;
    }

    return KeysetPageClass;
}