import { BasePropertyMetadata, WithDefaultMetadata } from './base-property-metadata.model';
import { OmitStrict } from '../../types';

export type NumberPropertyMetadata = BasePropertyMetadata & WithDefaultMetadata<number> & {
    type: 'number',
    primary: boolean,
    unique: boolean,
    min: number | undefined,
    max: number | undefined
};

export type NumberPropertyMetadataInput = Partial<OmitStrict<NumberPropertyMetadata, 'type'>>;