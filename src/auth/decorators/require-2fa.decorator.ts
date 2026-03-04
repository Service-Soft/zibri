import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { TwoFactorMethods } from '../2fa/two-factor-methods.model';
import { Require2faMetadata } from '../models/require-2fa-metadata.model';

/**
 * The type of the require 2fa decorator.
 */
export interface Require2faFn {
    (allowedMethods?: TwoFactorMethods): MethodDecorator & ClassDecorator,
    /**
     * This skips the require 2fa validation.
     */
    skip: () => MethodDecorator & ClassDecorator
}

/**
 * Marks an endpoint to be only reachable when the logged in user provides a second factor somehow.
 * @param allowedMethods - The allowed two factor methods to use.
 */
export const require2faDecorator: Require2faFn
    = (allowedMethods?: TwoFactorMethods) => {
        const fullMetadata: Require2faMetadata = {
            allowedMethods: allowedMethods ?? []
        };

        const decorator: MethodDecorator & ClassDecorator = (
            target: Object,
            propertyKey?: string | symbol
        ) => {
            if (propertyKey !== undefined) {
                MetadataUtilities.setRouteRequire2fa(target.constructor, fullMetadata, propertyKey as string);
            }
            else {
                MetadataUtilities.setControllerRequire2fa(target as Function, fullMetadata);
            }
        };
        return decorator;
    };

require2faDecorator.skip = () => (
    target: Object,
    propertyKey?: string | symbol
) => {
    if (propertyKey !== undefined) {
        MetadataUtilities.setRouteSkipRequire2fa(target.constructor, {}, propertyKey as string);
    }
    else {
        MetadataUtilities.setControllerSkipRequire2fa(target as Function, {});
    }
};