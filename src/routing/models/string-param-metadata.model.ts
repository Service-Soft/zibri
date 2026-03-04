import { BaseParamMetadata } from './base-param-metadata.model';
import { StringPropertyMetadata } from '../../entity/models/string-property-metadata.model';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Metadata for string parameters.
 */
export type StringParamMetadata = BaseParamMetadata & OmitStrict<StringPropertyMetadata, 'primary' | 'default' | 'excludeFromChangeSets'>;

/**
 * Metadata Input for string parameters.
 */
export type StringParamMetadataInput = Partial<OmitStrict<StringParamMetadata, 'name'>> & Pick<StringParamMetadata, 'type'>;