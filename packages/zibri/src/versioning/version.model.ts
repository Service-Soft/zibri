import { type SemVerVersion } from './sem-ver.utilities';
import { StoredRoute } from './stored-route.model';
import { Property } from '../entity/decorators/property.decorator';

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
export class VersionFile implements Version {
    /**
     * The actual version value in the SemVer format.
     */
    @Property.string()
    value!: SemVerVersion;
    /**
     * The date after which this should be the active version. Used for date based version resolution.
     */
    @Property.date()
    startsAt!: Date;
    /**
     * The end date of this version. Can be left open if the version is the current latest.
     */
    @Property.date({ required: false })
    endsAt?: Date | null;
    /**
     * The routes at the time of the version bump.
     */
    @Property.array({ items: { type: 'object', cls: () => StoredRoute } })
    routes!: StoredRoute[];
}