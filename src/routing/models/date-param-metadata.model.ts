import { BaseParamMetadata } from './base-param-metadata.model';
import { DatePropertyMetadata } from '../../entity';
import { OmitStrict } from '../../types';

/**
 * Metadata for Date parameters.
 */
export type DateParamMetadata = BaseParamMetadata & OmitStrict<DatePropertyMetadata, 'default'>;

/**
 * Metadata Input for Date parameters.
 */
export type DateParamMetadataInput = Partial<OmitStrict<DateParamMetadata, 'name'>> & Pick<DateParamMetadata, 'type'>;