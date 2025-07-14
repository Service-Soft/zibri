import { Jwt } from './jwt.model';
import { Property } from '../../entity';

/**
 * The authentication data that gets returned when logging in or refreshing the login.
 */
export class JwtAuthData<Role extends string> {
    /**
     * The id of the user of the jwt.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;

    /**
     * The short lived access token.
     */
    @Property.object({ cls: () => Jwt })
    accessToken!: Jwt;

    /**
     * The long lived refresh token.
     */
    @Property.object({ cls: () => Jwt })
    refreshToken!: Jwt;

    /**
     * The roles of the user.
     */
    @Property.array({ items: { type: 'string' } })
    roles!: Role[];
}