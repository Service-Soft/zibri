import { JwtAccessTokenPayload } from './jwt-access-token-payload.model.ts';
import { JwtHeader } from './jwt-header.model.ts';
import { BaseUser } from '../../models/base-user.model.ts';

/**
 * An encoded jwt, with whatever was signed into it.
 *
 * `Payload` defaults to `unknown`, which is what verification actually establishes: that the token
 * was issued by this application and has not been altered since. It says nothing about the shape of
 * what was put inside, and the framework signs two different shapes - narrow it with the type guard
 * belonging to the payload you expect.
 */
export type EncodedJwt<Payload = unknown> = {
    /**
     * The header of the jwt, contains mostly metadata.
     */
    header: JwtHeader,
    /**
     * The payload of the jwt, everything that was put inside the token when generating it can be found here.
     */
    payload: Payload
};

/**
 * An encoded jwt access token.
 */
export type EncodedJwtAccessToken<Role extends string> = EncodedJwt<JwtAccessTokenPayload<Role, BaseUser<Role>>>;