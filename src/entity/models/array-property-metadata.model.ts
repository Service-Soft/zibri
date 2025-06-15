import { ExcludeStrict } from '../../types';
import { PropertyMetadata, RelationMetadata } from '../decorators';
import { BaseEntity } from './base-entity.model';
import { BasePropertyMetadata } from './base-property-metadata.model';
import { BooleanPropertyMetadataInput } from './boolean-property-metadata.model';
import { DatePropertyMetadataInput } from './date-property-metadata.model';
import { FilePropertyMetadataInput, FileSize } from './file-property-metadata.model';
import { NumberPropertyMetadataInput } from './number-property-metadata.model';
import { ObjectPropertyMetadataInput } from './object-property-metadata.model';
import { StringPropertyMetadataInput } from './string-property-metadata.model';

export type ArrayPropertyMetadata = BasePropertyMetadata & {
    type: 'array',
    items: ArrayPropertyItemMetadata
};

export type ArrayPropertyItemMetadata = ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity>>;

export type ArrayPropertyItemMetadataInput = StringPropertyMetadataInput & { type: 'string' }
    | NumberPropertyMetadataInput & { type: 'number' }
    | ObjectPropertyMetadataInput & { type: 'object' }
    | ArrayPropertyMetadataInput & { type: 'array' }
    | DatePropertyMetadataInput & { type: 'date' }
    | BooleanPropertyMetadataInput & { type: 'boolean' }
    | FilePropertyMetadataInput & { type: 'file' };

type DefaultArrayPropertyMetadataInput = Partial<BasePropertyMetadata> & {
    items: ExcludeStrict<ArrayPropertyItemMetadataInput, FileArrayPropertyMetadataInput['items']>,
    totalFileSize?: never
};

type FileArrayPropertyMetadataInput = Partial<BasePropertyMetadata> & {
    items: FilePropertyMetadataInput & { type: 'file' },
    totalFileSize?: FileSize
};

export type ArrayPropertyMetadataInput = DefaultArrayPropertyMetadataInput | FileArrayPropertyMetadataInput;