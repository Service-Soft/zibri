import { JwtHeader } from 'jsonwebtoken';

import { JwtAccessTokenPayload } from './jwt-access-token-payload.model';
import { BaseUser } from '../../models';

/**
 * An encoded jwt access token.
 */
export type EncodedJwtAccessToken<Role extends string> = {
    /**
     * The header of the jwt, contains mostly metadata.
     */
    header: JwtHeader,
    /**
     * The payload of the jwt, everything that was put inside the token when generating it can be found here.
     */
    payload: JwtAccessTokenPayload<Role, BaseUser<Role>>,
    /**
     * The signature of the jwt.
     */
    signature: string
};