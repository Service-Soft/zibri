import { SupportedVersionsOptions } from './supported-versions-options.model';
import { Version, VersionFile } from './version.model';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { SemVerVersion } from '../utilities/sem-ver.utilities';

/**
 * Interface for a versioning service.
 */
export interface VersioningServiceInterface {
    /**
     * Resolves the version from the given request context.
     */
    resolveVersion: (context: HttpRequestContext | WebsocketRequestContext) => Version | Promise<Version>,
    /**
     * Checks if any of the given version options matches the resolved version.
     */
    matchesVersion: (versions: SupportedVersionsOptions, resolvedVersion: Version) => boolean,
    /**
     * Finds overlapping versions between two options.
     */
    findOverlappingVersions: (
        a: SupportedVersionsOptions,
        b: SupportedVersionsOptions,
        currentLatest: SemVerVersion
    ) => SupportedVersionsOptions,
    /**
     * Refuses a declaration whose versions overlap with one made before it, naming what is declared
     * twice and for which versions.
     * @param subject - What is declared, as the error names it, such as `The route "GET /tasks"`.
     * @param declared - The versions of the declaration made before.
     * @param versions - The versions of the one being made.
     * @param currentLatest - The current latest version.
     * @param definedOn - How the error ends, such as `has been defined more than once.`.
     * @throws A VersionOverlapError when the two overlap.
     */
    validateNoOverlap: (
        subject: string,
        declared: SupportedVersionsOptions,
        versions: SupportedVersionsOptions,
        currentLatest: SemVerVersion,
        definedOn: string
    ) => void,
    /**
     * Checks whether or not the given options have some overlap.
     */
    hasOverlappingVersions: (
        a: SupportedVersionsOptions,
        b: SupportedVersionsOptions,
        currentLatest: SemVerVersion
    ) => boolean,
    /**
     * Returns all versions created in the file system.
     */
    getVersions: () => VersionFile[]
}