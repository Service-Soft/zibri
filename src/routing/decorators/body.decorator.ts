import { MetadataUtilities } from '../../encapsulation';
import { Newable } from '../../types';

export type BodyMetadata = {
    modelClass: Newable<unknown>,
    index: number,
    name: string,
    description?: string,
    required: boolean
};

export function Body(modelClass: Newable<unknown>, options: Partial<Pick<BodyMetadata, 'required'>> = {}): ParameterDecorator {
    return (target, propertyKey, index) => {
        const fullMetadata: BodyMetadata = {
            index,
            modelClass,
            name: modelClass.name,
            required: true,
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