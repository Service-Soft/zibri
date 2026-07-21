import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { AuthStrategies } from '../strategies/auth-strategies.model';

/**
 * Metadata of the \@CurrentUser decorator.
 */
export type CurrentUserMetadata = {
    /**
     * The index at which the parameter exists that should be injected as the currently logged in user.
     */
    index: number,
    /**
     * Whether or not the injected user is required or not.
     * Defaults to true.
     */
    required: boolean,
    /**
     * The allowed auth strategies to resolve the currently logged in user. If not provided, any strategy is allowed.
     */
    allowedStrategies?: AuthStrategies
};

/**
 * Marks the parameter to be injected as the currently logged in user.
 * @param required - If set to false, the injected user is allowed to be undefined.
 * @param allowedStrategies - The allowed auth strategies to resolve the currently logged in user. If not provided, any strategy is allowed.
 */
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