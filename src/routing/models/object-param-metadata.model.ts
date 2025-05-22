import { BaseParamMetadata } from './base-param-metadata.model';
import { ObjectPropertyMetadata } from '../../entity';
import { OmitStrict } from '../../types';

export type ObjectParamMetadata = BaseParamMetadata & ObjectPropertyMetadata;

export type ObjectParamMetadataInput = Partial<OmitStrict<ObjectParamMetadata, 'name'>> & Pick<ObjectParamMetadata, 'cls'>;