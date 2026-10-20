import { Transaction } from '../../../data-source/transaction/transaction.model.ts';
import { OmitClass } from '../../../entity/omit-class.model.ts';

/**
 * Data for refreshing a login with the cookie auth strategy.
 */
export class CookieAuthRefreshLoginData {
    /**
     * The transaction that this should run in.
     */
    transaction!: Transaction;
}

/**
 * The body a refresh of the cookie auth strategy is sent with: nothing, the cookies carry the login.
 */
export class CookieAuthRefreshLoginDto extends OmitClass(CookieAuthRefreshLoginData, ['transaction']) {}