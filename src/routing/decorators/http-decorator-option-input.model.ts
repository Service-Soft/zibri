import { SupportedVersionsOptions } from '../../versioning/supported-versions-options.model';

/**
 * Base options shared by all http decorators.
 */
export type BaseHttpDecoratorInput = {
    /**
     * Configuration on what versions are supported.
     */
    versions?: SupportedVersionsOptions
};