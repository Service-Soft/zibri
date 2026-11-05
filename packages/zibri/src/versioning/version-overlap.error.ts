import { SupportedVersionsOptions } from './supported-versions-options.model';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * An error for a route, a base route or a websocket event that is declared twice for versions that
 * overlap, so a request of one of them could reach either declaration.
 */
export class VersionOverlapError extends InternalError {
    constructor(subject: string, overlapping: SupportedVersionsOptions, definedOn: string) {
        super(overlapping === 'all'
            ? `${subject} ${definedOn} (versions: 'all' has been used)`
            : `${subject} for the ${overlapping.length > 1 ? 'versions' : 'version'} "${overlapping.join(', ')}" ${definedOn}`);
        this.name = 'VersionOverlapError';
    }
}