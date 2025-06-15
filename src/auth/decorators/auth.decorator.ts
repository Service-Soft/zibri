import { belongsToDecorator, BelongsToFn } from './belongs-to.decorator';
import { hasRoleDecorator, HasRoleFn } from './has-role.decorator';
import { isLoggedInDecorator, IsLoggedInFn } from './is-logged-in.decorator';
import { isNotLoggedInDecorator, IsNotLoggedInFn } from './is-not-logged-in.decorator';
import { MetadataUtilities } from '../../utilities';

// eslint-disable-next-line typescript/no-namespace
export namespace Auth {
    export const isLoggedIn: IsLoggedInFn = isLoggedInDecorator;
    export const isNotLoggedIn: IsNotLoggedInFn = isNotLoggedInDecorator;
    export const hasRole: HasRoleFn = hasRoleDecorator;
    export const belongsTo: BelongsToFn = belongsToDecorator;

    export function skip(): MethodDecorator {
        return (target, propertyKey) => {
            MetadataUtilities.setRouteSkipAuth(target.constructor, {}, propertyKey as string);
        };
    }
}