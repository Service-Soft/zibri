import { RouteWithVersionData } from './route-with-version-data.model';
import { SemVerVersion } from '../utilities/sem-ver.utilities';

/**
 * A version, consisting of the actual version value and a starts end end date.
 */
export type Version = {
    /**
     * The actual version value in the SemVer format.
     */
    value: SemVerVersion,
    /**
     * The date after which this should be the active version. Used for date based version resolution.
     */
    startsAt: Date,
    /**
     * The end date of this version. Can be left open if the version is the current latest.
     */
    endsAt?: Date | null
};

/**
 * Data stored inside of a version file.
 */
export type VersionFile = Version & {
    /**
     * The routes at the time of the version bump.
     */
    routes: RouteWithVersionData[]
};