import { AuthenticatorInterface, isAuthenticator } from './authenticator.interface';
import type { IdentityLinkingAuthenticators } from './identity-linking-authenticators.model';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { BaseEntity } from '../../entity/base-entity.model';
import { BaseUser } from '../models/base-user.model';

/**
 * Interface for an authenticator that logs users in with an identity they have somewhere else, such
 * as an account at a provider. An identity logs in as the user it is linked to.
 *
 * An application reaches what it adds through `AuthServiceInterface`.
 */
export interface IdentityLinkingAuthenticatorInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>,
    CredentialsType,
    TicketType,
    RegistrationType,
    IdentityType extends Pick<BaseEntity, 'id'>,
    LinkIdentityRequestType,
    LinkIdentityStartType
> extends AuthenticatorInterface<RoleType, UserType, CredentialsType> {
    /**
     * Reads who logged in, for creating the user they become, from the ticket a first login
     * continues with. Does not spend the ticket.
     */
    resolveRegistration: (ticket: TicketType, transaction: RepositoryTransaction | undefined) => Promise<RegistrationType>,
    /**
     * Links the identity a ticket names to a user, so the ticket logs them in and every later login
     * with the identity finds them. Does not spend the ticket.
     */
    linkTicketIdentity: (ticket: TicketType, userId: string, transaction: RepositoryTransaction | undefined) => Promise<void>,
    /**
     * Requests linking an identity to a user who exists already, as the request says. Answers with
     * what the browser needs to go on with it, such as the url of a provider, and links the identity
     * once the user has proven they hold it.
     */
    requestLinkIdentity: (userId: string, request: LinkIdentityRequestType) => Promise<LinkIdentityStartType>,
    /**
     * Finds the identities linked to a user.
     */
    findIdentities: (userId: string, transaction: RepositoryTransaction | undefined) => Promise<IdentityType[]>,
    /**
     * Unlinks an identity from a user. Throws a NotFoundError when the user has no identity of that id.
     */
    unlinkIdentity: (userId: string, identityId: string, transaction: RepositoryTransaction | undefined) => Promise<void>
}

/**
 * Checks whether or not the given value is an authenticator that links identities to users.
 * @param value - The value to check.
 * @returns True if it is an authenticator and has every key IdentityLinkingAuthenticatorInterface adds.
 */
export function isIdentityLinkingAuthenticator(value: unknown): value is InstanceType<IdentityLinkingAuthenticators[number]> {
    if (!isAuthenticator(value)) {
        return false;
    }
    const keys: string[] = ['resolveRegistration', 'linkTicketIdentity', 'requestLinkIdentity', 'findIdentities', 'unlinkIdentity'];
    return keys.every(key => key in value);
}