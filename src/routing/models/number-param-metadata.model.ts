import { BaseParamMetadata } from './base-param-metadata.model';
import { NumberPropertyMetadata } from '../../entity/models/number-property-metadata.model';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Metadata for number parameters.
 */
export type NumberParamMetadata = BaseParamMetadata & OmitStrict<
    NumberPropertyMetadata,
    'primary' | 'default' | 'exclude' | 'excludeFromChangeSets'
>;

/**
 * Metadata Input for number parameters.
 */
export type NumberParamMetadataInput = Partial<OmitStrict<NumberParamMetadata, 'name'>> & Pick<NumberParamMetadata, 'type'>;