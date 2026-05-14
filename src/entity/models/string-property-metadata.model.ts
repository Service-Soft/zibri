import { BasePropertyMetadata, WithDefaultMetadata } from './base-property-metadata.model';
import { EncryptOptions } from '../../auth/encryption/encryption-service.interface';
import { BaseDecryptOptions, BaseEncryptOptions, EncryptionStrategyInterface } from '../../auth/encryption/strategies/encryption-strategy.interface';
import { HashOptions } from '../../auth/hash/hash-service.interface';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { AnyEnum } from '../../types/any-enum.type';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { AnyObject } from '../any-object.model';

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
     * The encryption strategy that should be used.
     */
    strategy: Newable<EncryptionStrategyInterface<TKey, TEncryptOptions, TDecryptOptions>>,
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

// eslint-disable-next-line jsdoc/require-jsdoc
type EncryptPropertyValue<Data, TKey, TEncryptOptions extends BaseEncryptOptions<TKey>> = boolean
    | EncryptOptions<TKey, TEncryptOptions>['strategyOptions']
    | (
        (
            data: Data,
            ctx: HttpRequestContext | WebsocketRequestContext | undefined
        ) => (EncryptOptions<TKey, TEncryptOptions>['strategyOptions'] | boolean)
            | Promise<EncryptOptions<TKey, TEncryptOptions>['strategyOptions'] | boolean>
    );

// eslint-disable-next-line jsdoc/require-jsdoc
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
 * The possible formats a string value can have.
 */
export type StringFormat = 'uuid' | 'email';

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
     * Enabling this also turns on 'uuid' as the format and sets 'unique' to true.
     */
    primary: boolean,
    /**
     * The format of the property, or undefined if none.
     */
    format: StringFormat | undefined,
    /**
     * Whether or not the property should be unique.
     */
    unique: boolean,
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
 * Input Metadata for string properties.
 */
export type StringPropertyMetadataInput<
    Data,
    TKey,
    TEncryptOptions extends BaseEncryptOptions<TKey>,
    TDecryptOptions extends BaseDecryptOptions<TKey>,
    THashOptions extends AnyObject
> = Partial<OmitStrict<StringPropertyMetadata<Data, TKey, TEncryptOptions, TDecryptOptions, THashOptions>, 'type'>>;