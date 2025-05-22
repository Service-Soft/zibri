import { BaseParamMetadata } from './base-param-metadata.model';
import { DatePropertyMetadata } from '../../entity';
import { OmitStrict } from '../../types';

export type DateParamMetadata = BaseParamMetadata & DatePropertyMetadata;

export type DateParamMetadataInput = Partial<OmitStrict<DateParamMetadata, 'name'>>;