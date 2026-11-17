import { Jwt } from './jwt.model';

/**
 * What a login, a refresh and a change of the tenant with the jwt strategy answer.
 */
export type JwtAuthData<Role extends string = string> = {
    /**
     * The id of the user.
     */
    userId: string,
    /**
     * The token every request sends.
     */
    accessToken: Jwt,
    /**
     * The token that gets new tokens once the access token runs out.
     */
    refreshToken: Jwt,
    /**
     * The roles of the user.
     */
    roles: Role[]
};