import { HandlerTimeout } from '../../http/handler-timeout.type';
import { SupportedVersionsOptions } from '../../versioning/supported-versions-options.model';

/**
 * Base options shared by all http decorators.
 */
export type BaseHttpDecoratorInput = {
    /**
     * Configuration on what versions are supported.
     */
    versions?: SupportedVersionsOptions,
    /**
     * How long the handler of this route has to produce a result.
     *
     * Overrides what the controller says, which overrides the application's `handlerInMs`. Use
     * `'none'` for a route that legitimately runs for as long as it takes.
     */
    timeoutInMs?: HandlerTimeout
};