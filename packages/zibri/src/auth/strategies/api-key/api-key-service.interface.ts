import { ApiKeyClientAuthentication } from './api-key-client-authentication.model.ts';
import { ApiKeyCreateData } from './api-key-create-data.model.ts';
import { ApiKey } from './api-key.model.ts';
import { CreatedApiKey } from './created-api-key.model.ts';
import { ZibriApplication } from '../../../application/application.ts';
import { Transaction } from '../../../data-source/transaction/transaction.model.ts';

/**
 * Interface for the service keeping the api keys of the users.
 *
 * `AuthService` creates and revokes keys through it, and every strategy and route reading a key finds
 * it here. Keys exist in an application once something reads them.
 */
export interface ApiKeyServiceInterface {
    /**
     * Registers something that reads api keys, such as a strategy, while the application starts. Throws
     * a MissingEntitiesError naming the reader when the application declares no `ApiKey`.
     */
    registerReader: (app: ZibriApplication, reader: string) => void,
    /**
     * Creates an api key that is a secret, and answers with the key itself, which is only ever handed
     * out here. Throws a BadRequestError when the name is empty, the user lacks one of the roles, or the
     * key would have expired already.
     */
    create: <Role extends string>(
        userId: string,
        data: ApiKeyCreateData<Role, undefined>,
        transaction: Transaction | undefined
    ) => Promise<CreatedApiKey>,
    /**
     * Creates an api key without a secret, which proves itself the way `clientAuthentication` says at
     * the token endpoint of the authorization server. Throws a BadRequestError like `create`, and when
     * what it proves itself with cannot be used.
     */
    createClient: <Role extends string>(
        userId: string,
        data: ApiKeyCreateData<Role, ApiKeyClientAuthentication>,
        transaction: Transaction | undefined
    ) => Promise<ApiKey>,
    /**
     * Finds the api keys of a user, expired ones included, oldest first.
     */
    findForUser: (userId: string, transaction: Transaction | undefined) => Promise<ApiKey[]>,
    /**
     * Finds the api key a key is, while it has not expired.
     */
    findActiveByKey: (key: string) => Promise<ApiKey | undefined>,
    /**
     * Finds an api key by its id, while it has not expired.
     */
    findActiveById: (id: string) => Promise<ApiKey | undefined>,
    /**
     * Writes down that an api key was used, unless its last use written down is more recent than
     * `recordUseAfterMs` of `API_KEY_OPTIONS`.
     */
    recordUse: (apiKey: ApiKey) => Promise<void>,
    /**
     * Revokes an api key of a user. Throws a NotFoundError when the user has no key with that id.
     */
    revoke: (userId: string, apiKeyId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Revokes every api key of a user. Does nothing in an application where nothing reads api keys.
     */
    revokeForUser: (userId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Deletes the api keys that expired longer ago than `deleteExpiredAfterMs` of `API_KEY_OPTIONS`.
     */
    deleteExpired: () => Promise<void>
}