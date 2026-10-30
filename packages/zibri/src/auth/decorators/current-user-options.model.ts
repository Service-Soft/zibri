import { AuthStrategies } from '../strategies/auth-strategies.model';

/**
 * Options of the \@CurrentUser decorator.
 */
export type CurrentUserOptions = {
    /**
     * Whether a request without a logged in user is refused. When false, the parameter is undefined
     * for such a request instead.
     * @default true
     */
    required?: boolean,
    /**
     * The auth strategies that may resolve the user. Every strategy of the application by default.
     */
    authStrategies?: AuthStrategies
};