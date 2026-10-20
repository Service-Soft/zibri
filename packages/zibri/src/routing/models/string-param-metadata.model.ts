import { BaseParamMetadata } from './base-param-metadata.model.ts';
import { StoredStringPropertyMetadata } from '../../entity/models/string-property-metadata.model.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

/**
 * Metadata for string parameters.
 */
export type StringParamMetadata = BaseParamMetadata & OmitStrict<
    StoredStringPropertyMetadata,
    // encryption and hashing are what a repository does to a value it stores, and a parameter is read
    // from a request rather than stored - so nothing would ever act on either flag here
    'primary' | 'default' | 'exclude' | 'excludeFromChangeSets' | 'index' | 'fuzzySearchable' | 'optimisticLocking'
    | 'encryption' | 'hash'
>;

/**
 * Metadata Input for string parameters.
 */
export type StringParamMetadataInput = Partial<OmitStrict<StringParamMetadata, 'name'>> & Pick<StringParamMetadata, 'type'>;