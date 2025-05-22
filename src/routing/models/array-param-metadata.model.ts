import { BaseParamMetadata } from './base-param-metadata.model';
import { ArrayPropertyMetadata } from '../../entity';
import { OmitStrict } from '../../types';
import { QueryParamMetadata, QueryParamMetadataInput } from '../decorators';

export type ArrayParamMetadata = BaseParamMetadata & ArrayPropertyMetadata;

export type ArrayParamMetadataInput = Partial<OmitStrict<ArrayParamMetadata, 'type' | 'items'>>
    & { items: QueryParamMetadataInput & Pick<QueryParamMetadata, 'type'> };