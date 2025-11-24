import { AuthStrategies } from '../strategies';
import { SkipAuthMetadata } from './skip-auth-metadata.model';

/**
 * Metadata for the \@Auth.hasRole decorator.
 */
export type HasRoleMetadata = {
    /**
     * The allowed roles that the use can have to access the endpoint.
     */
    allowedRoles: string[],
    /**
     * The strategies that are allowed for checking whether or not the user has one of the specified roles.
     *
     * If not set, this allows any strategy.
     */
    allowedStrategies?: AuthStrategies
};

/**
 * Metadata for the \@Auth.hasRole.skip decorator.
 */
export type SkipHasRoleMetadata = SkipAuthMetadata;