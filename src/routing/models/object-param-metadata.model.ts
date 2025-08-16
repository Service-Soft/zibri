import { BaseParamMetadata } from './base-param-metadata.model';
import { ObjectPropertyMetadata } from '../../entity';
import { OmitStrict } from '../../types';

/**
 * Metadata for object parameters.
 */
export type ObjectParamMetadata = BaseParamMetadata & OmitStrict<ObjectPropertyMetadata, 'excludeFromChangeSets'>;

/**
 * Metadata Input for object parameters.
 */
export type ObjectParamMetadataInput = Partial<OmitStrict<ObjectParamMetadata, 'name'>> & Pick<ObjectParamMetadata, 'cls' | 'type'>;