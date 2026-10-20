import { BaseParamMetadata } from './base-param-metadata.model.ts';
import { DatePropertyMetadata } from '../../entity/models/date-property-metadata.model.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

/**
 * Metadata for Date parameters.
 */
export type DateParamMetadata = BaseParamMetadata & OmitStrict<
    DatePropertyMetadata,
    'default' | 'exclude' | 'excludeFromChangeSets' | 'index' | 'optimisticLocking'
>;

/**
 * Metadata Input for Date parameters.
 */
export type DateParamMetadataInput = Partial<OmitStrict<DateParamMetadata, 'name'>> & Pick<DateParamMetadata, 'type'>;