import { BasePropertyMetadata, WithDefaultMetadata } from './base-property-metadata.model';
import { OmitStrict } from '../../types';

export type DatePropertyMetadata = BasePropertyMetadata & WithDefaultMetadata<Date> & {
    type: 'date',
    after: Date | undefined,
    before: Date | undefined
};

export type DatePropertyMetadataInput = Partial<OmitStrict<DatePropertyMetadata, 'type'>>;