import { BaseParamMetadata } from './base-param-metadata.model';
import { StringPropertyMetadata } from '../../entity';
import { OmitStrict } from '../../types';

export type StringParamMetadata = BaseParamMetadata & OmitStrict<StringPropertyMetadata, 'primary' | 'default'>;

export type StringParamMetadataInput = Partial<OmitStrict<StringParamMetadata, 'name'>> & Pick<StringParamMetadata, 'type'>;