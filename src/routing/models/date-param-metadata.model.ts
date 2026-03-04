import { BaseParamMetadata } from './base-param-metadata.model';
import { DatePropertyMetadata } from '../../entity/models/date-property-metadata.model';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Metadata for Date parameters.
 */
export type DateParamMetadata = BaseParamMetadata & OmitStrict<DatePropertyMetadata, 'default' | 'excludeFromChangeSets'>;

/**
 * Metadata Input for Date parameters.
 */
export type DateParamMetadataInput = Partial<OmitStrict<DateParamMetadata, 'name'>> & Pick<DateParamMetadata, 'type'>;