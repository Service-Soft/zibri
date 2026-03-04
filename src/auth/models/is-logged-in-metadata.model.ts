import { SkipAuthMetadata } from './skip-auth-metadata.model';
import { AuthStrategies } from '../strategies/auth-strategies.model';

/**
 * Metadata for the \@Auth.isLoggedIn decorator.
 */
export type IsLoggedInMetadata = {
    /**
     * The strategies that are allowed for checking whether or not the user is logged in.
     *
     * If not set, this allows any strategy.
     */
    allowedStrategies?: AuthStrategies
};

/**
 * Metadata for the \@Auth.isLoggedIn.skip decorator.
 */
export type SkipIsLoggedInMetadata = SkipAuthMetadata;