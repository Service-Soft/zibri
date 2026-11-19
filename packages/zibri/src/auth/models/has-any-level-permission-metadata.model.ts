import { AuthStrategies } from '../strategies/auth-strategies.model';
import { AnyLevelPermissions } from './any-level-permissions.model';

/**
 * Metadata for the \@Auth.hasAnyLevelPermission decorator.
 */
export type HasAnyLevelPermissionMetadata = AnyLevelPermissions & {
    /**
     * The strategies that are allowed for checking whether or not the user has one of the permissions.
     *
     * If not set, this allows any strategy.
     */
    allowedStrategies?: AuthStrategies
};