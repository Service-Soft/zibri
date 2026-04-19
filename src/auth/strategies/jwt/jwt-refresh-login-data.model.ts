import { Transaction } from '../../../data-source/transaction/transaction.model';
import { Property } from '../../../entity/decorators/property.decorator';

/**
 * The data used to refresh a login inside the jwt auth strategy.
 */
export class JwtRefreshLoginData {
    /**
     * The long lived refresh token.
     */
    @Property.string()
    refreshToken!: string;
    /**
     * The transaction that this should run in.
     */
    transaction!: Transaction;
}