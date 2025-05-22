import { BasePropertyMetadata } from './base-property-metadata.model';
import { OmitStrict } from '../../types';

export type DatePropertyMetadata = BasePropertyMetadata & {
    type: 'date'
};

export type DatePropertyMetadataInput = Partial<OmitStrict<DatePropertyMetadata, 'type'>>;