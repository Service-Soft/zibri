import { Transaction } from '../../../data-source/transaction/transaction.model.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { OmitClass } from '../../../entity/omit-class.model.ts';

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

/**
 * The body a refresh and a logout of the jwt auth strategy are sent with.
 */
export class JwtRefreshLoginDto extends OmitClass(JwtRefreshLoginData, ['transaction']) {}