import { hasRoleDecorator, HasRoleFn } from './has-role.decorator';
import { isLoggedInDecorator, IsLoggedInFn } from './is-logged-in.decorator';
import { isNotLoggedInDecorator, IsNotLoggedInFn } from './is-not-logged-in.decorator';

// eslint-disable-next-line typescript/no-namespace
export namespace Auth {
    export const isLoggedIn: IsLoggedInFn = isLoggedInDecorator;
    export const isNotLoggedIn: IsNotLoggedInFn = isNotLoggedInDecorator;
    export const hasRole: HasRoleFn = hasRoleDecorator;

    // export function belongsTo(): MethodDecoratorWithSkip | ClassDecoratorWithSkip {

    // }

    // export function none(): MethodDecoratorWithSkip | ClassDecoratorWithSkip {

    // }
}