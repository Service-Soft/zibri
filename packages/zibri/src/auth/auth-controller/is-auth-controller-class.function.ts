import type { AuthControllerClass } from './auth-controller-class.type';

/**
 * Checks whether a controller class was defined by `AuthController`.
 * @param value - The class.
 * @returns True when it was.
 */
export function isAuthControllerClass(value: unknown): value is AuthControllerClass {
    return typeof value === 'function' && 'authControllerOptions' in value;
}