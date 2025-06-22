import { BasePropertyMetadata, WithDefaultMetadata } from './base-property-metadata.model';
import { AnyEnum, OmitStrict } from '../../types';

export type StringFormat = 'uuid' | 'email';

export type StringPropertyMetadata = BasePropertyMetadata & WithDefaultMetadata<string> & {
    type: 'string',
    primary: boolean,
    format: StringFormat | undefined,
    unique: boolean,
    minLength: number | undefined,
    maxLength: number | undefined,
    regex: string | RegExp | undefined,
    enum: AnyEnum | undefined
};

export type StringPropertyMetadataInput = Partial<OmitStrict<StringPropertyMetadata, 'type'>>;