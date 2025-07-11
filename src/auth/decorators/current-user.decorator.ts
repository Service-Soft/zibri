import { MetadataUtilities } from '../../utilities';
import { AuthStrategies } from '../models';

export type CurrentUserMetadata = {
    index: number,
    required: boolean,
    allowedStrategies?: AuthStrategies
};

export function CurrentUser(required?: boolean, allowedStrategies?: AuthStrategies): ParameterDecorator {
    return (target, propertyKey, index) => {
        const fullMetadata: CurrentUserMetadata = {
            required: required ?? true,
            index,
            allowedStrategies
        };
        const ctor: Function = target.constructor;
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(ctor, stack);
        const key: string = propertyKey?.toString() ?? '';
        MetadataUtilities.setRouteCurrentUser(ctor, fullMetadata, key);
    };
}