import { BaseParamMetadata } from './base-param-metadata.model';
import { BooleanPropertyMetadata } from '../../entity';
import { OmitStrict } from '../../types';

export type BooleanParamMetadata = BaseParamMetadata & OmitStrict<BooleanPropertyMetadata, 'default'>;

export type BooleanParamMetadataInput = Partial<OmitStrict<BooleanParamMetadata, 'name'>> & Pick<BooleanParamMetadata, 'type'>;