import { BasePropertyMetadata, WithDefaultMetadata } from './base-property-metadata.model';
import { OmitStrict } from '../../types';

export type BooleanPropertyMetadata = BasePropertyMetadata & WithDefaultMetadata<boolean> & {
    type: 'boolean'
};

export type BooleanPropertyMetadataInput = Partial<OmitStrict<BooleanPropertyMetadata, 'type'>>;