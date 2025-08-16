import { AuthStrategies } from './auth-strategies.model';
import { SkipAuthMetadata } from './skip-auth-metadata.model';

/**
 * Metadata for the \@Auth.isNotLoggedIn decorator.
 */
export type IsNotLoggedInMetadata = {
    /**
     * The strategies that are allowed for checking whether or not the user is not logged in.
     *
     * If not set, this allows any strategy.
     */
    allowedStrategies?: AuthStrategies
};

/**
 * Metadata for the \@Auth.isNotLoggedIn.skip decorator.
 */
export type SkipIsNotLoggedInMetadata = SkipAuthMetadata;