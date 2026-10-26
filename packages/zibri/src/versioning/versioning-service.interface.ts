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