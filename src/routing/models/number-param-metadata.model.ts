import { BaseParamMetadata } from './base-param-metadata.model';
import { NumberPropertyMetadata } from '../../entity';
import { OmitStrict } from '../../types';

export type NumberParamMetadata = BaseParamMetadata & OmitStrict<NumberPropertyMetadata, 'primary'>;

export type NumberParamMetadataInput = Partial<OmitStrict<NumberParamMetadata, 'name'>>;