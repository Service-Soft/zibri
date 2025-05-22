import { BasePropertyMetadata } from './base-property-metadata.model';
import { OmitStrict } from '../../types';

export type BooleanPropertyMetadata = BasePropertyMetadata & {
    type: 'boolean'
};

export type BooleanPropertyMetadataInput = Partial<OmitStrict<BooleanPropertyMetadata, 'type'>>;