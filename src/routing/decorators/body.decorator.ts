import { BasePropertyMetadata } from '../../entity/models/base-property-metadata.model';
import { MimeType } from '../../http';
import { Newable, OmitStrict } from '../../types';
import { MetadataUtilities } from '../../utilities';

type BaseBodyMetadata = BasePropertyMetadata & {
    modelClass: Newable<unknown>,
    index: number
};

export type JsonBodyMetadata = BaseBodyMetadata & {
    type: MimeType.JSON
};

export type FormDataBodyMetadata = BaseBodyMetadata & {
    type: MimeType.FORM_DATA
};

export type BodyMetadata = JsonBodyMetadata | FormDataBodyMetadata;

export type BodyMetadataInput = Partial<OmitStrict<BodyMetadata, 'modelClass' | 'index'>>;

export function Body(modelClass: Newable<unknown>, options: BodyMetadataInput = {}): ParameterDecorator {
    return (target, propertyKey, index) => {
        const fullMetadata: BodyMetadata = {
            index,
            modelClass,
            required: true,
            description: undefined,
            type: MimeType.JSON,
            ...options
        };
        const ctor: Function = target.constructor;
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(ctor, stack);
        const key: string = propertyKey?.toString() ?? '';
        MetadataUtilities.setRouteBody(ctor, fullMetadata, key);
    };
}