import { RepositoryHooks } from './repository-hooks.model';
import { type EncryptionServiceInterface } from '../../auth/encryption/encryption-service.interface';
import { type HashServiceInterface } from '../../auth/hash/hash-service.interface';

/**
 * What the hooks of a repository run with: the hooks the application provides, and the services the
 * default ones encrypt and hash with.
 */
export type RepositoryHookServices = {
    /**
     * The hooks the application provides under `ZIBRI_DI_TOKENS.REPOSITORY_HOOKS`.
     */
    hooks: RepositoryHooks,
    /**
     * What the encrypted properties are encrypted and decrypted with.
     */
    encryptionService: EncryptionServiceInterface,
    /**
     * What the hashed properties are hashed with.
     */
    hashService: HashServiceInterface
};