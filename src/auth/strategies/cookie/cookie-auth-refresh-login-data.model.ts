import { Transaction } from '../../../data-source/transaction/transaction.model';

/**
 * Data for refreshing a login with the cookie auth strategy.
 */
export class CookieAuthRefreshLoginData {
    /**
     * The transaction that this should run in.
     */
    transaction!: Transaction;
}