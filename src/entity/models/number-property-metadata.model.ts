import { BasePropertyMetadata } from './base-property-metadata.model';
import { OmitStrict } from '../../types';

export type NumberPropertyMetadata = BasePropertyMetadata & {
    type: 'number',
    primary: boolean,
    unique: boolean
};

export type NumberPropertyMetadataInput = Partial<OmitStrict<NumberPropertyMetadata, 'type'>>;