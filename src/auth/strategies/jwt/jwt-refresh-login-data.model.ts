import { Property } from '../../../entity';

/**
 * The data used to refresh a login inside the jwt auth strategy.
 */
export class JwtRefreshLoginData {
    /**
     * The long lived refresh token.
     */
    @Property.string()
    refreshToken!: string;
}