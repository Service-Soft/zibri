import { BaseParamMetadata } from './base-param-metadata.model';
import { BooleanPropertyMetadata } from '../../entity/models/boolean-property-metadata.model';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Metadata for boolean parameters.
 */
export type BooleanParamMetadata = BaseParamMetadata & OmitStrict<BooleanPropertyMetadata, 'default' | 'excludeFromChangeSets'>;

/**
 * Metadata Input for boolean parameters.
 */
export type BooleanParamMetadataInput = Partial<OmitStrict<BooleanParamMetadata, 'name'>> & Pick<BooleanParamMetadata, 'type'>;