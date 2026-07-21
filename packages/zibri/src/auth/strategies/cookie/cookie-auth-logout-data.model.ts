import { Transaction } from '../../../data-source/transaction/transaction.model';
import { Property } from '../../../entity/decorators/property.decorator';

/**
 * Data for logging a user out with the cookie auth strategy.
 */
export class CookieAuthLogoutData {
    /**
     * Whether or not cookies should be cleared.
     */
    @Property.boolean()
    clearCookies!: boolean;
    /**
     * The id of the refresh session to logout.
     */
    @Property.string({ format: 'uuid' })
    refreshSessionId!: string;
    /**
     * The transaction that this should run in.
     */
    transaction: Transaction | undefined;
}