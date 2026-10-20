import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { Require2faMetadata } from '../models/require-2fa-metadata.model.ts';

/**
 * The type of the require 2fa decorator.
 */
export interface Require2faFn {
    (options?: Require2faMetadata): MethodDecorator & ClassDecorator,
    /**
     * This skips the require 2fa validation.
     */
    skip: () => MethodDecorator & ClassDecorator
}

/**
 * Marks an endpoint to be only reachable when the logged in user provides a second factor somehow.
 * @param options - Which two factor methods are allowed, and whether a recent login is accepted instead.
 */
export const require2faDecorator: Require2faFn
    = (options?: Require2faMetadata) => {
        // both left undefined rather than filled in here, because neither default is the same thing
        // as its value. An undefined allowedMethods means "whichever methods the app configured", an
        // empty list means "none of them" - filling it in turned @Auth.require2fa() with no argument
        // into a route nobody could ever satisfy. An undefined reauth means whatever
        // REQUIRE_2FA_REAUTH says when the route is checked, which a value taken here would freeze
        // before the application's providers are known.
        const fullMetadata: Require2faMetadata = { allowedMethods: options?.allowedMethods, reauth: options?.reauth };

        const decorator: MethodDecorator & ClassDecorator = (
            target: object,
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
    target: object,
    propertyKey?: string | symbol
) => {
    if (propertyKey !== undefined) {
        MetadataUtilities.setRouteSkipRequire2fa(target.constructor, {}, propertyKey as string);
    }
    else {
        MetadataUtilities.setControllerSkipRequire2fa(target as Function, {});
    }
};