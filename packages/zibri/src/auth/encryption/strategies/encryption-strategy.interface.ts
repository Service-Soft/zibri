import { EncryptionString } from '../encryption.utilities';

/**
 * Where an encrypted value belongs, so that it only decrypts there.
 *
 * Encryption keeps a value secret from whoever reads the database. It says nothing about a value
 * that was *moved*: everything needed to decrypt lives in the stored value, so anyone who can write
 * to the database can copy one row's encrypted value into another row and have the application
 * decrypt it for the wrong subject. A strategy that authenticates this refuses that value instead.
 *
 * The row is all that is named here, deliberately. Binding to the entity and the property as well
 * would also stop a value being moved between two encrypted columns of the *same* row - but it would
 * make renaming a table or a column destroy every value in it, silently, at the next read. A move
 * that crosses rows already changes the id, and that is the attack worth stopping.
 */
export type EncryptionBinding = {
    /**
     * The id of the row the value belongs to, or undefined for a value that is free to move between
     * rows. Either way the envelope header is authenticated, which it is not for a value written
     * before binding existed.
     */
    rowId: string | undefined
};

/**
 * The base options required for encrypting a value.
 */
export type BaseEncryptOptions<TKey> = {
    /**
     * The id of the key to use.
     */
    keyId: string,
    /**
     * The actual key value.
     */
    key: TKey,
    /**
     * Where the value belongs, when it is being written to an entity.
     *
     * Part of the base contract rather than one strategy's extra, because binding a value to its
     * place is a guarantee the framework makes and every strategy has to be able to honour or
     * refuse - not something a caller has to remember to ask for.
     */
    binding?: EncryptionBinding
};

/**
 * The base options required for decrypting a value.
 */
export type BaseDecryptOptions<TKey> = {
    /**
     * The id of the key to use.
     */
    keyId: string,
    /**
     * The actual key value.
     */
    key: TKey,
    /**
     * Where the value is being read from, checked against where it was written.
     */
    binding?: EncryptionBinding
};

/**
 * Interface for an encryption strategy.
 */
export interface EncryptionStrategyInterface<
    TKey,
    TEncryptOptions extends BaseEncryptOptions<TKey> = BaseEncryptOptions<TKey>,
    TDecryptOptions extends BaseDecryptOptions<TKey> = BaseDecryptOptions<TKey>
> {
    /**
     * The name of the strategy.
     */
    readonly name: string,
    /**
     * The version of the strategy.
     */
    readonly version: string,
    /**
     * Whether the strategy can encrypt and decrypt while a migration runs.
     *
     * Migrations run before the application is initialized, so a strategy that relies on something
     * set up while it is - a client of a key management service started by another provider, for
     * one - cannot. A migration using a strategy that says false is refused, naming the strategy.
     */
    readonly usableInMigrations: boolean,
    /**
     * Encrypts the given value with the given options.
     */
    encrypt: (value: string, options: TEncryptOptions) => EncryptionString | Promise<EncryptionString>,
    /**
     * Decrypts the given value with the given options.
     */
    decrypt: (value: EncryptionString, options: TDecryptOptions) => string | Promise<string>,
    /**
     * Whether the given stored value is bound to the row it was written to.
     *
     * Only the strategy can answer this, because only it knows what it wrote. Asking is what lets a
     * value stored before binding existed be found and rewritten, instead of staying movable forever
     * - so a strategy that cannot bind at all answers false and its values are swept every time,
     * which is the honest reading of "not stored the way it should be".
     */
    isBoundToRow: (value: EncryptionString) => boolean,
    /**
     * Generates a new random key.
     */
    generateRandomKey: () => TKey | Promise<TKey>,
    /**
     * Serializes the given key into a Buffer.
     */
    serializeKey: (key: TKey) => Buffer | Promise<Buffer>,
    /**
     * Resolves a key from the given Buffer.
     */
    deserializeKey: (raw: Buffer) => TKey | Promise<TKey>
}