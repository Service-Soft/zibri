import { BaseParamMetadata } from './base-param-metadata.model.ts';
import { NumberPropertyMetadata } from '../../entity/models/number-property-metadata.model.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

/**
 * Metadata for number parameters.
 */
export type NumberParamMetadata = BaseParamMetadata & OmitStrict<
    NumberPropertyMetadata,
    'primary' | 'default' | 'exclude' | 'excludeFromChangeSets' | 'index' | 'optimisticLocking'
>;

/**
 * Metadata Input for number parameters.
 */
export type NumberParamMetadataInput = Partial<OmitStrict<NumberParamMetadata, 'name'>> & Pick<NumberParamMetadata, 'type'>;