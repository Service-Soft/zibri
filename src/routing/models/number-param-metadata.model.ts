import { BaseParamMetadata } from './base-param-metadata.model';
import { NumberPropertyMetadata } from '../../entity';
import { OmitStrict } from '../../types';

/**
 * Metadata for number parameters.
 */
export type NumberParamMetadata = BaseParamMetadata & OmitStrict<NumberPropertyMetadata, 'primary' | 'default'>;

/**
 * Metadata Input for number parameters.
 */
export type NumberParamMetadataInput = Partial<OmitStrict<NumberParamMetadata, 'name'>> & Pick<NumberParamMetadata, 'type'>;