import { ExcludeStrict } from '../types/exclude-strict.type';
import { SemVerVersion } from '../utilities/sem-ver.utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
type SemVerRange = `^${number}` | `^${number}.${number}` | `^${SemVerVersion}`
    | `~${number}` | `~${number}.${number}` | `~${SemVerVersion}`
    | `>=${SemVerVersion}`
    | `>${SemVerVersion}`
    | `<=${SemVerVersion}`
    | `<${SemVerVersion}`;

/**
 * Matcher for a version.
 */
export type VersionMatcher = 'latest' | '^latest' | '~latest' | SemVerVersion | SemVerRange | `${SemVerRange} ${SemVerRange}`;

/**
 * Matcher for a semver version.
 */
export type SemVerMatcher = ExcludeStrict<VersionMatcher, 'latest' | '^latest' | '~latest'>;

/**
 * The options available to define what versions are supported by eg. A route.
 */
export type SupportedVersionsOptions = 'all' | (VersionMatcher)[];