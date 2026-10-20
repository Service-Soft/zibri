import { BasePropertyMetadata, WithDefaultMetadata } from './base-property-metadata.model.ts';
import { UniqueDeclaration } from './unique-declaration.model.ts';
import { EncryptOptions } from '../../auth/encryption/encryption-service.interface.ts';
import { BaseDecryptOptions, BaseEncryptOptions, EncryptionStrategyInterface } from '../../auth/encryption/strategies/encryption-strategy.interface.ts';
import { HashOptions } from '../../auth/hash/hash-service.interface.ts';
import { HttpRequestContext } from '../../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context.ts';
import { AnyEnum } from '../../types/any-enum.type.ts';
import { Newable } from '../../types/newable.type.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';
import { AnyObject } from '../any-object.model.ts';

/**
 * Options for encrypt and decrypt.
 */
export type EncryptAndDecryptOptions<
    Data,
    TKey,
    TEncryptOptions extends BaseEncryptOptions<TKey>,
    TDecryptOptions extends BaseDecryptOptions<TKey>
> = {
    /**
     * The encryption strategy that should be used, or undefined for the default one.
     */
    strategy?: Newable<EncryptionStrategyInterface<TKey, TEncryptOptions, TDecryptOptions>>,
    /**
     * Whether the encrypted value is bound to the row it is stored in, so that it only decrypts
     * there. Defaults to true.
     *
     * Encryption protects a value that was *read*; it does not protect one that was *moved*.
     * Everything needed to decrypt lives in the stored value, so anyone who gains a write to the
     * database - a sql injection, an over-permissive admin screen, a broken import - can copy one
     * row's encrypted value into another row and have the application decrypt it for the wrong
     * subject. Binding puts the row id inside the authentication tag, so a value that was moved
     * refuses to decrypt at all.
     *
     * What it costs is bulk writes of this property: a bound value has to be encrypted for the row it
     * lands in, so `updateAll` cannot write one to many rows in a single statement and has to read
     * the rows it matched instead. Turn it off for a value that is meant to be the same across rows,
     * or where that cost outweighs the guarantee.
     */
    bindToRow?: boolean,
    /**
     * The encrypt options.
     */
    encrypt?: EncryptPropertyValue<Data, TKey, TEncryptOptions>,
    /**
     * The decrypt options.
     */
    decrypt?: DecryptPropertyValue<Data, OmitStrict<TDecryptOptions, 'keyId' | 'key'>>
};

/**
 * Value for the encryption setting on a property.
 */
export type EncryptionPropertyValue<
    Data,
    TKey,
    TEncryptOptions extends BaseEncryptOptions<TKey>,
    TDecryptOptions extends BaseDecryptOptions<TKey>
> = boolean
    | EncryptAndDecryptOptions<Data, TKey, TEncryptOptions, TDecryptOptions>
    | (
        (
            data: Data,
            ctx: HttpRequestContext | WebsocketRequestContext | undefined
        ) => EncryptAndDecryptOptions<Data, TKey, TEncryptOptions, TDecryptOptions>
            | Promise<EncryptAndDecryptOptions<Data, TKey, TEncryptOptions, TDecryptOptions>>
    );

// eslint-disable-next-line jsdoc-js/require-jsdoc
type EncryptPropertyValue<Data, TKey, TEncryptOptions extends BaseEncryptOptions<TKey>> = boolean
    | EncryptOptions<TKey, TEncryptOptions>['strategyOptions']
    | (
        (
            data: Data,
            ctx: HttpRequestContext | WebsocketRequestContext | undefined
        ) => (EncryptOptions<TKey, TEncryptOptions>['strategyOptions'] | boolean)
            | Promise<EncryptOptions<TKey, TEncryptOptions>['strategyOptions'] | boolean>
    );

// eslint-disable-next-line jsdoc-js/require-jsdoc
type DecryptPropertyValue<Data, T extends AnyObject> = boolean | T
    | ((data: Data, ctx: HttpRequestContext | WebsocketRequestContext | undefined) => (boolean | T) | Promise<boolean | T>);

/**
 * Value for the hash setting on a property.
 */
export type HashPropertyValue<Data, THashOptions extends AnyObject> = boolean | HashOptions<THashOptions>
    | (
        (
            data: Data,
            ctx: HttpRequestContext | WebsocketRequestContext | undefined
        ) => HashOptions<THashOptions> | Promise<HashOptions<THashOptions>>
    );

/**
 * The possible formats a string value can have. `phone` is a number in international format, eg.
 * `+4915112345678`.
 */
export type StringFormat = 'uuid' | 'email' | 'phone';

/**
 * Metadata for string properties.
 */
export type StringPropertyMetadata<
    Data,
    TKey,
    TEncryptOptions extends BaseEncryptOptions<TKey>,
    TDecryptOptions extends BaseDecryptOptions<TKey>,
    THashOptions extends AnyObject
> = BasePropertyMetadata & WithDefaultMetadata<string> & {
    /**
     * The type of the property.
     */
    type: 'string',
    /**
     * Whether or not the property is a primary key.
     * Enabling this also turns on 'uuid' as the format and sets 'unique' to true. A string primary
     * key always holds uuids, so declaring another format, or none, is refused.
     *
     * A primary key names at most one row through an index of its own, so declaring 'unique' or
     * 'index' beside it is refused.
     */
    primary: boolean,
    /**
     * The format of the property, or undefined if none.
     */
    format: StringFormat | undefined,
    /**
     * Whether or not the property should be unique, and among which rows.
     *
     * `true` is unique across the whole table. Naming a `where` narrows it to the rows that match,
     * which is how a value stays free for the rows the filter excludes - a soft deleted row no longer
     * occupying the address it was registered with, say. Use `whereFor` to type the filter against
     * the entity.
     */
    unique: UniqueDeclaration,
    /**
     * Whether or not the property should be indexed.
     *
     * A unique property is indexed by the constraint that enforces it, so declaring both is refused.
     */
    index: boolean,
    /**
     * Whether the property can be searched with `fuzzyLike`.
     *
     * On by default, and kept that way by an index over the trigrams of its values, so a search for
     * something similar to a value reads that index rather than the table. Declaring it false takes
     * both away: the index is not kept, and a `fuzzyLike` naming the property is refused. That is the
     * declaration for a column written far more often than it is searched.
     *
     * A value that is a uuid, one of an enum, hashed or encrypted is not similar to anything, so
     * those are refused whatever this says.
     */
    fuzzySearchable: boolean,
    /**
     * Whether writing this property requires saying what it was.
     *
     * Last write wins everywhere by default, which is right for most properties and silent data loss
     * for the ones two people edit at once. Declaring this refuses an update that names the property
     * unless the filter names it too, so the write becomes a compare and set: it lands only if the
     * value is still the one the caller acted on.
     */
    optimisticLocking: boolean,
    /**
     * The minimum length of the property, or undefined if not limited.
     */
    minLength: number | undefined,
    /**
     * The maximum length of the property, or undefined if not limited.
     */
    maxLength: number | undefined,
    /**
     * A regex to validate the property, or undefined.
     */
    regex: string | RegExp | undefined,
    /**
     * An enum that this property is one of.
     */
    enum: AnyEnum<string> | undefined,
    /**
     * Settings for encrypting/decrypting this property.
     */
    encryption: EncryptionPropertyValue<Data, TKey, TEncryptOptions, TDecryptOptions>,
    /**
     * Settings for hashing this property.
     */
    hash: HashPropertyValue<Data, THashOptions>
};

/**
 * Metadata for string properties, as it is stored and read back.
 *
 * A declaration names the type of the data its settings are given, the key type of its encryption
 * strategy and the options that strategy takes, so that the options are checked against the strategy
 * where they are written. Nothing reading the metadata back needs those types: the strategy is resolved
 * from its class when a value is encrypted, and hands its own key to itself.
 */
export type StoredStringPropertyMetadata = StringPropertyMetadata<
    unknown,
    unknown,
    BaseEncryptOptions<unknown>,
    BaseDecryptOptions<unknown>,
    AnyObject
>;

/**
 * The encryption setting of a string property, as it is stored and read back.
 */
export type StoredEncryptionPropertyValue = StoredStringPropertyMetadata['encryption'];

/**
 * The hash setting of a string property, as it is stored and read back.
 */
export type StoredHashPropertyValue = StoredStringPropertyMetadata['hash'];

/**
 * Metadata for string properties, whatever encryption or hashing strategy they name.
 *
 * Where a declaration is written, its settings are checked against the strategy it names. This is what
 * it is after that check: the same declaration, now handled the same way whichever strategy it was.
 */
export type AnyStrategyStringPropertyMetadata = OmitStrict<StoredStringPropertyMetadata, 'encryption' | 'hash'> & {
    /**
     * Settings for encrypting/decrypting this property, checked where they were declared.
     */
    encryption: unknown,
    /**
     * Settings for hashing this property, checked where they were declared.
     */
    hash: unknown
};

/**
 * Input metadata for string properties, whatever encryption or hashing strategy they name.
 */
export type AnyStrategyStringPropertyMetadataInput = Partial<OmitStrict<AnyStrategyStringPropertyMetadata, 'type'>>;

/**
 * Input metadata for a string that comes in with a request or a response, which is read rather than
 * stored.
 */
export type IncomingStringPropertyMetadataInput = OmitStrict<
    StringPropertyMetadataInput,
    // encryption and hashing are what a repository does to a value it stores, so nothing would ever act
    // on either flag for a value that is only read
    'encryption' | 'hash'
>;

/**
 * Input Metadata for string properties.
 */
export type StringPropertyMetadataInput<
    Data = unknown,
    TKey = unknown,
    TEncryptOptions extends BaseEncryptOptions<TKey> = BaseEncryptOptions<TKey>,
    TDecryptOptions extends BaseDecryptOptions<TKey> = BaseDecryptOptions<TKey>,
    THashOptions extends AnyObject = AnyObject
> = Partial<OmitStrict<StringPropertyMetadata<Data, TKey, TEncryptOptions, TDecryptOptions, THashOptions>, 'type'>>;