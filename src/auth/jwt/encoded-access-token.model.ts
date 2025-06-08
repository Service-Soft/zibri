import { JwtHeader } from 'jsonwebtoken';

import { AccessTokenPayload } from './access-token-payload.model';
import { BaseUser } from '../models';

/**
 * An encoded token.
 */
export type EncodedAccessToken<Role extends string> = {
    /**
     * The header of the jwt, contains mostly metadata.
     */
    header: JwtHeader,
    /**
     * The payload of the jwt, everything that was put inside the token when generating it can be found here.
     */
    payload: AccessTokenPayload<Role, BaseUser<Role>>,
    /**
     * The signature of the jwt.
     */
    signature: string
};