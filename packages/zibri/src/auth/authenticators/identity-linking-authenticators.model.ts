import { IdentityLinkingAuthenticatorInterface } from './identity-linking-authenticator.interface.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { BaseUser } from '../models/base-user.model.ts';

/**
 * A list of authenticator classes that link identities to users, whose identities are of the given type.
 */
// any, because the credentials, the ticket and the connection request are parameters: authenticators
// taking different ones only share a list type through it, as on Authenticators
export type IdentityLinkingAuthenticators<IdentityType extends Pick<BaseEntity, 'id'> = Pick<BaseEntity, 'id'>> = Newable<
    // eslint-disable-next-line typescript/no-explicit-any
    IdentityLinkingAuthenticatorInterface<string, BaseUser<string>, any, any, unknown, IdentityType, any, unknown>
>[];