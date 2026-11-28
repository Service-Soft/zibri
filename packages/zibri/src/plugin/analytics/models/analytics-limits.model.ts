/* eslint-disable typescript/typedef */
import { type FileSize } from '../../../entity/models/file-property-metadata.model';

/**
 * What the analytics routes take at most, and the shapes of the values they take.
 */
// every value arrives from anybody on the internet, without a login, and becomes a row: each is bounded, and the
// host and the path are held to shapes that cannot carry a query string, which is where personal data in a url is
export abstract class AnalyticsLimits {
    /**
     * A host, such as `example.com` or `localhost:4200`, and never a url.
     */
    static readonly HOST_REGEX: RegExp = /^[\w.-]+(?::\d+)?$/;
    /**
     * The longest host, the longest name DNS allows.
     */
    static readonly HOST_MAX_LENGTH = 253;
    /**
     * A path, starting with `/`, without query and hash.
     */
    static readonly PATH_REGEX: RegExp = /^\/[^#?]*$/;
    /**
     * The longest path.
     */
    static readonly PATH_MAX_LENGTH = 1000;
    /**
     * A locale, such as `de` or `en-US`.
     */
    static readonly LANGUAGE_REGEX: RegExp = /^[\w-]+$/;
    /**
     * The longest locale.
     */
    static readonly LANGUAGE_MAX_LENGTH = 35;
    /**
     * The longest `utm_*` parameter.
     */
    static readonly UTM_MAX_LENGTH = 200;
    /**
     * The longest name and category of an event.
     */
    static readonly EVENT_NAME_MAX_LENGTH = 100;
    /**
     * The largest body of a page view or an event, which every value above at its longest fits in.
     */
    static readonly BODY_MAX_SIZE: FileSize = '4kb';
    /**
     * The most steps a funnel follows.
     */
    static readonly FUNNEL_MAX_STEPS = 10;
}