import { BaseParamMetadata } from './base-param-metadata.model';
import { ArrayPropertyMetadata } from '../../entity';
import { OmitStrict } from '../../types';
import { QueryParamMetadata, QueryParamMetadataInput } from '../decorators';

/**
 * Metadata for array parameters.
 */
export type ArrayParamMetadata = BaseParamMetadata & ArrayPropertyMetadata;

/**
 * Metadata Input for array parameters.
 */
export type ArrayParamMetadataInput = Partial<OmitStrict<ArrayParamMetadata, 'type' | 'items'>>
    & Pick<ArrayParamMetadata, 'type'>
    & {
        /**
         * Metadata of the array items.
         */
        items: QueryParamMetadataInput & Pick<QueryParamMetadata, 'type'>
    };