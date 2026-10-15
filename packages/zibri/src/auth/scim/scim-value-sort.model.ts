import { OrderDirection } from '../../entity/models/entity-order.model';

/**
 * A sort of users by an attribute without a column of its own.
 */
export type ScimValueSort = {
    /**
     * The paths the values of users are kept under, eg. `emails.value`, or for an attribute without
     * a sub-attribute both its own and that of its `value`, which a complex one is sorted by.
     */
    paths: string[],
    // eslint-disable-next-line jsdoc/require-jsdoc
    direction: OrderDirection
};