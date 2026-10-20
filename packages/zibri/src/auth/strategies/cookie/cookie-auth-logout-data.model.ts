import { Transaction } from '../../../data-source/transaction/transaction.model.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { OmitClass } from '../../../entity/omit-class.model.ts';

/**
 * Data for logging a user out with the cookie auth strategy. The login that ends is the one whose
 * cookies the request carries.
 */
export class CookieAuthLogoutData {
    /**
     * Whether or not cookies should be cleared.
     */
    @Property.boolean()
    clearCookies!: boolean;
    /**
     * The transaction that this should run in.
     */
    transaction: Transaction | undefined;
}

/**
 * The body a logout of the cookie auth strategy is sent with.
 */
export class CookieAuthLogoutDto extends OmitClass(CookieAuthLogoutData, ['transaction']) {}