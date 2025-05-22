import { BasePropertyMetadata } from './base-property-metadata.model';
import { Newable, OmitStrict } from '../../types';

export type ObjectPropertyMetadata = BasePropertyMetadata & {
    type: 'object',
    cls: Newable<unknown>
};

export type ObjectPropertyMetadataInput = Partial<OmitStrict<ObjectPropertyMetadata, 'type'>>
    & Pick<ObjectPropertyMetadata, 'cls'>;