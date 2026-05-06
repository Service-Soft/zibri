import { BaseParamMetadata } from './base-param-metadata.model';
import { BaseDecryptOptions, BaseEncryptOptions } from '../../auth/encryption/strategies/encryption-strategy.interface';
import { AnyObject } from '../../entity/any-object.model';
import { StringPropertyMetadata } from '../../entity/models/string-property-metadata.model';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Metadata for string parameters.
 */
export type StringParamMetadata<
    Data,
    TKey,
    TEncryptOptions extends BaseEncryptOptions<TKey>,
    TDecryptOptions extends BaseDecryptOptions<TKey>,
    THashOptions extends AnyObject
> = BaseParamMetadata & OmitStrict<
    StringPropertyMetadata<Data, TKey, TEncryptOptions, TDecryptOptions, THashOptions>,
    'primary' | 'default' | 'exclude' | 'excludeFromChangeSets'
>;

/**
 * Metadata Input for string parameters.
 */
export type StringParamMetadataInput<
    Data,
    TKey,
    TEncryptOptions extends BaseEncryptOptions<TKey>,
    TDecryptOptions extends BaseDecryptOptions<TKey>,
    THashOptions extends AnyObject
> = Partial<OmitStrict<StringParamMetadata<Data, TKey, TEncryptOptions, TDecryptOptions, THashOptions>, 'name'>>
    & Pick<StringParamMetadata<Data, TKey, TEncryptOptions, TDecryptOptions, THashOptions>, 'type'>;