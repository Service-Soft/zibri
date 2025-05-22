import { BasePropertyMetadata } from './base-property-metadata.model';
import { OmitStrict } from '../../types';

export type StringFormat = 'uuid' | 'email';

export type StringPropertyMetadata = BasePropertyMetadata & {
    type: 'string',
    primary: boolean,
    format: StringFormat | undefined,
    unique: boolean
};

export type StringPropertyMetadataInput = Partial<OmitStrict<StringPropertyMetadata, 'type'>>;