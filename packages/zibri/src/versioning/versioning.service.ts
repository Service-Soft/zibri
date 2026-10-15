import { Dirent } from 'node:fs';

import { RouteWithVersionData } from './route-with-version-data.model';
import { SemVerUtilities, SemVerVersion } from './sem-ver.utilities';
import { StoredRoute } from './stored-route.model';
import { SemVerMatcher, SupportedVersionsOptions, VersionMatcher } from './supported-versions-options.model';
import { Version, VersionFile } from './version.model';
import { VersioningServiceInterface } from './versioning-service.interface';
import { ZibriApplication } from '../application/application';
import { HttpRequestContext } from '../context/request/http-request.context';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../context/request/request-context-token.model';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { InternalError } from '../error-handling/internal-error.model';
import { AfterAppInit } from '../global/after-app-init.interface';
import { type Header } from '../http/header.type';
import { $f } from '../localization/format.function';
import { $ts } from '../localization/translate.function';
import { parseObject } from '../parsing/functions/parse-object.function';
import { isNamedValue } from '../parsing/functions/parse-one-of.function';
import { ControllerRouteConfiguration } from '../routing/controller-route-configuration.model';
import { ControllerData } from '../routing/decorators/controller.decorator';
import { type RouterInterface } from '../routing/router.interface';
import { OmitStrict } from '../types/omit-strict.type';
import { type FsPath, FsUtilities } from '../utilities/fs.utilities';
import { isDate } from '../utilities/is-date.function';
import { JsonUtilities } from '../utilities/json.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { WebsocketControllerData } from '../websocket/decorators/websocket-controller.decorator';
import { WebsocketControllerRouteConfiguration } from '../websocket/models/websocket-controller-route-configuration.model';

/**
 * An error to throw when there were routes with mismatching versions.
 */
class RouteVersionMismatchError extends InternalError {
    constructor(errors: string[]) {
        super([
            'Route version mismatch detected:',
            ...errors.map(error => `- ${error}`)
        ]);
        this.name = 'RouteVersionMismatchError';
    }
}

/**
 * An error to throw during versioning service initialization.
 */
class InitVersioningServiceError extends InternalError {
    constructor(message: string | string[]) {
        const messageArray: string[] = typeof message === 'string' ? [message] : message;
        super(['Error initializing versioning service.', ...messageArray]);
        this.name = 'InitVersioningServiceError';
    }
}

/**
 * Default implementation of the versioning service.
 */
@Injectable({ register: 'onUse' })
export class VersioningService implements VersioningServiceInterface, AfterAppInit {

    private versionFiles: VersionFile[] = [];

    constructor(
        @Inject(ZIBRI_DI_TOKENS.VERSION_HEADER)
        private readonly versionHeader: Header,
        @Inject(ZIBRI_DI_TOKENS.VERSION_QUERY_PARAM)
        private readonly versionQueryParam: string,
        @Inject(ZIBRI_DI_TOKENS.ROUTER)
        private readonly router: RouterInterface,
        @Inject(ZIBRI_DI_TOKENS.VERSIONS_PATH)
        private readonly versionsPath: FsPath
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async afterAppInit(app: ZibriApplication): Promise<void> {
        // the folder belongs to the project rather than to a run: `zi new` creates it and git carries
        // it from there. Creating it here would make a deployment that failed to bring it look
        // exactly like a project that has never versioned anything, and those want opposite answers
        // - the second legitimately records a first snapshot, while the first would silently start
        // over and drop every guarantee the stored routes exist to give, with nothing to say so
        if (!await FsUtilities.exists(this.versionsPath)) {
            throw new InitVersioningServiceError([
                `There is no versions folder at "${this.versionsPath}".`,
                'It holds the routes each released version served, which is what a version bump is checked against,',
                'so it travels with the application: commit it, and copy it into whatever a deployment runs from.',
                'Create it empty to start recording versions from this one.'
            ]);
        }
        // another instance starting from the same folder can record the version between this one
        // reading the folder and writing to it. What it recorded is then read again, and judged like
        // any history that was there before
        if (await this.recordVersion(app)) {
            return;
        }
        if (!await this.recordVersion(app)) {
            throw new InitVersioningServiceError(
                `The versions folder at "${this.versionsPath}" kept changing while the application started.`
            );
        }
    }

    /**
     * Checks the routes against the recorded versions, and records the version the application is on.
     * @param app - The application.
     * @returns Whether it was recorded, false when another instance recorded the same version meanwhile.
     */
    private async recordVersion(app: ZibriApplication): Promise<boolean> {
        this.versionFiles = await this.loadAllVersionFiles();
        const currentLatestVersions: VersionFile[] = this.versionFiles.filter(v => v.endsAt == undefined);

        if (currentLatestVersions.length === 1 && currentLatestVersions.at(0)?.value === app.options.version) {
            // is already at the latest version, doesn't need to do anything.
            return true;
        }

        if (!this.versionFiles.length) {
            const created: boolean = await this.createVersionFile({
                startsAt: new Date(),
                value: app.options.version,
                routes: this.getAllRoutes(app).map(r => this.toStoredRoute(r))
            });
            this.versionFiles = await this.loadAllVersionFiles();
            return created;
        }

        const currentLatest: VersionFile | undefined = this.resolveCurrentLatest(currentLatestVersions, app);
        const inCodeRoutes: RouteWithVersionData[] = this.getAllRoutes(app);
        const storedRoutes: RouteWithVersionData[] = currentLatest ? currentLatest.routes.map(r => this.fromStoredRoute(r)) : [];

        this.validateNoDowngrade(app);
        this.validateRouteVersionSnapshot(inCodeRoutes, storedRoutes, this.versionFiles, currentLatest?.value, app.options.version);
        this.validateRouteVersionsExist(inCodeRoutes, this.versionFiles, app.options.version);
        this.validateLatestRoutes(inCodeRoutes, app.options.version, this.versionFiles);

        // Create new version file (deprecate the old one)
        const transitionTime: Date = new Date();
        const newVersion: VersionFile | undefined = this.versionFiles.find(v => v.value === app.options.version);

        if (newVersion != undefined) {
            // Sort old active versions (excluding the new one) by startsAt
            const oldActives: VersionFile[] = currentLatestVersions
                .filter(v => v.value !== app.options.version)
                .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

            // Chain the end dates: each old version ends when the next one starts
            for (const [i, oldActive] of oldActives.entries()) {
                const next: VersionFile | undefined = oldActives[i + 1];
                const nextStart: Date = new Date(next?.startsAt ?? newVersion.startsAt);
                await this.updateVersionFile(oldActive, { endsAt: nextStart });
            }

            // Ensure the new file’s routes are up to date
            await this.updateVersionFile(newVersion, { routes: inCodeRoutes.map(r => this.toStoredRoute(r)) });
            this.versionFiles = await this.loadAllVersionFiles();
            return true;
        }

        const created: boolean = await this.createVersionFile({
            value: app.options.version,
            startsAt: transitionTime,
            routes: inCodeRoutes.map(r => this.toStoredRoute(r))
        });
        if (!created) {
            return false;
        }

        for (const active of currentLatestVersions) {
            await this.updateVersionFile(active, { endsAt: transitionTime });
        }
        this.versionFiles = await this.loadAllVersionFiles();
        return true;
    }

    private validateNoDowngrade(app: ZibriApplication): void {
        const latestVersion: VersionFile = this.versionFiles.reduce(
            (max, v) => SemVerUtilities.compare(v.value, max.value) === 'bigger' ? v : max
        );
        if (SemVerUtilities.compare(latestVersion.value, app.options.version) === 'bigger') {
            throw new InitVersioningServiceError(
                [
                    `Version "${app.options.version}" was previously active but has been superseded by "${latestVersion.value}".`,
                    'Downgrading is not supported automatically. To resolve this, either:',
                    '- Revert your code and version files together via git',
                    `- Manually delete and update version files so that "${app.options.version}" is treated as a fresh version`
                ]
            );
        }
    }

    private resolveCurrentLatest(currentLatestVersions: VersionFile[], app: ZibriApplication): VersionFile | undefined {
        if (currentLatestVersions.length === 1) {
            return currentLatestVersions.at(0);
        }
        if (currentLatestVersions.length < 1) {
            return this.versionFiles.reduce((max, v) => SemVerUtilities.compare(v.value, max.value) === 'bigger' ? v : max);
        }

        const currentLatest: VersionFile | undefined = currentLatestVersions.find(v => v.value !== app.options.version);
        if (!currentLatest) {
            throw new InitVersioningServiceError([
                'Inconsistent version state: multiple active versions exist, but they all represent the global version.',
                'Check for duplicate version files.'
            ]);
        }
        return currentLatest;
    }

    private async loadAllVersionFiles(): Promise<VersionFile[]> {
        const entries: Dirent[] = await FsUtilities.readdir(FsUtilities.getPath(this.versionsPath));
        const res: (VersionFile | undefined)[] = await Promise.all(entries.map(async e => {
            if (!e.isFile() || !e.name.endsWith('.json')) {
                return undefined;
            }
            const raw: string = await FsUtilities.readFile(FsUtilities.getPath(e.parentPath, e.name));
            return parseObject(raw, VersionFile) as VersionFile;
        }));
        const files: VersionFile[] = res.filter(Boolean) as VersionFile[];
        this.validateVersionsAreNamed(files);
        return files;
    }

    private validateVersionsAreNamed(files: VersionFile[]): void {
        const unnamed: string[] = files.flatMap(file => file.routes
            .filter(route => {
                const versions: unknown = route.versions;
                return !isNamedValue(versions) || (versions.shape !== 'All' && versions.shape !== 'Matchers');
            })
            .map(route => `- "${file.value}.json" on route "${route.key}"`));
        if (!unnamed.length) {
            return;
        }
        throw new InitVersioningServiceError([
            'These routes in the versions folder hold their versions without the name of their shape:',
            ...unnamed,
            'Rewrite "versions": "all" as "versions": { "shape": "All", "value": "all" },',
            'and "versions": [...] as "versions": { "shape": "Matchers", "value": [...] }.'
        ]);
    }

    private toStoredRoute(route: RouteWithVersionData): StoredRoute {
        return {
            key: route.key,
            versions: route.versions === 'all' ? { shape: 'All', value: 'all' } : { shape: 'Matchers', value: route.versions }
        };
    }

    private fromStoredRoute(route: StoredRoute): RouteWithVersionData {
        return { key: route.key, versions: route.versions.value };
    }

    /**
     * Records a version.
     * @param data - The version.
     * @returns Whether it was recorded, false when another instance recorded it first.
     */
    private async createVersionFile(data: VersionFile): Promise<boolean> {
        return await FsUtilities.createFileIfAbsent(
            FsUtilities.getPath(this.versionsPath, `${data.value}.json`),
            JsonUtilities.stringify(data)
        );
    }

    private async updateVersionFile(versionFile: VersionFile, data: Partial<OmitStrict<VersionFile, 'value'>>): Promise<void> {
        const updated: VersionFile = { ...versionFile, ...data };
        await FsUtilities.updateFile(
            FsUtilities.getPath(this.versionsPath, `${versionFile.value}.json`),
            JsonUtilities.stringify(updated),
            'replace'
        );
    }

    private validateRouteVersionSnapshot(
        inCodeRoutes: RouteWithVersionData[],
        storedRoutes: RouteWithVersionData[],
        versionFiles: VersionFile[],
        currentLatest: SemVerVersion | undefined,
        newVersion: SemVerVersion
    ): void {
        if (!currentLatest) {
            return;
        }
        const knownVersions: Set<SemVerVersion> = new Set(versionFiles.map(e => e.value));
        const errors: string[] = [];

        for (const storedRoute of storedRoutes) {
            const routes: RouteWithVersionData[] = inCodeRoutes.filter(r => r.key === storedRoute.key);

            if (!routes.length) {
                errors.push(`Route "${storedRoute.key}" no longer exists in code.`);
                continue;
            }

            const removedVersions: SemVerVersion[] = this.getRemovedVersions(
                storedRoute.versions,
                routes.some(r => r.versions === 'all')
                    ? 'all'
                    : routes.flatMap(r => r.versions === 'all' ? [] : r.versions),
                [...knownVersions],
                currentLatest,
                newVersion

            );
            if (!removedVersions.length) {
                continue;
            }

            const versionLabel: string = removedVersions.length > 1 ? 'versions' : 'version';
            errors.push(
                `Route "${storedRoute.key}" removed ${versionLabel}: ${removedVersions.join(', ')}`
            );
        }

        if (errors.length) {
            throw new RouteVersionMismatchError(errors);
        }
    }

    private getRemovedVersions(
        previous: SupportedVersionsOptions,
        current: SupportedVersionsOptions,
        knownVersions: SemVerVersion[],
        currentLatest: SemVerVersion,
        newVersion: SemVerVersion
    ): SemVerVersion[] {
        const previousResolved: SemVerVersion[] = this.resolveConcreteVersions(previous, knownVersions, currentLatest);
        const currentResolved: SemVerVersion[] = this.resolveConcreteVersions(current, knownVersions, newVersion);

        return previousResolved.filter(v => !currentResolved.includes(v));
    }

    private resolveConcreteVersions(
        versions: SupportedVersionsOptions,
        knownVersions: SemVerVersion[],
        currentLatest: SemVerVersion
    ): SemVerVersion[] {
        if (versions === 'all') {
            return [...knownVersions];
        }

        const resolvedMatchers: SemVerMatcher[] = versions.map(
            v => this.versionMatcherToSemVerMatcher(v, currentLatest)
        );

        return knownVersions.filter(version => SemVerUtilities.matches(version, resolvedMatchers));
    }

    private validateRouteVersionsExist(
        inCodeRoutes: RouteWithVersionData[],
        versionFiles: VersionFile[],
        newVersion: SemVerVersion
    ): void {
        const knownVersions: SemVerVersion[] = versionFiles.map(v => v.value);
        const candidateVersions: SemVerVersion[] = [...knownVersions, newVersion];
        const errors: string[] = [];

        // eslint-disable-next-line typescript/typedef
        const validateRoute = (route: RouteWithVersionData, latest: SemVerVersion, location: string): void => {
            if (route.versions === 'all') {
                return;
            }

            for (const matcher of route.versions) {
                const resolvedMatcher: SemVerMatcher = this.versionMatcherToSemVerMatcher(matcher, latest);

                const matchesAny: boolean = candidateVersions.some(version => SemVerUtilities.matches(version, [resolvedMatcher]));

                if (!matchesAny) {
                    errors.push(`Unknown version "${matcher}" ${location}`);
                }
            }
        };

        for (const file of versionFiles) {
            for (const route of file.routes) {
                validateRoute(this.fromStoredRoute(route), file.value, `in version file "${file.value}.json" on route "${route.key}"`);
            }
        }

        if (errors.length) {
            throw new RouteVersionMismatchError(errors);
        }

        for (const route of inCodeRoutes) {
            validateRoute(route, newVersion, `on route "${route.key}"`);
        }

        if (errors.length) {
            throw new RouteVersionMismatchError(errors);
        }
    }

    private validateLatestRoutes(
        inCodeRoutes: RouteWithVersionData[],
        currentVersion: SemVerVersion,
        allVersionFiles: VersionFile[]
    ): void {
        const previousCandidates: VersionFile[] = allVersionFiles.filter(
            v => v.endsAt == undefined && v.value !== currentVersion
        );
        if (previousCandidates.length === 0) {
            return;
        }

        const previousLatest: VersionFile = previousCandidates.reduce((max, v) => new Date(v.startsAt) > new Date(max.startsAt) ? v : max);
        const previousRoutesByKey: Map<string, RouteWithVersionData> = new Map(
            previousLatest.routes.map(route => [route.key, this.fromStoredRoute(route)])
        );

        const routesThatNeedUpdate: RouteWithVersionData[] = inCodeRoutes.filter(r => {
            if (r.versions === 'all') {
                return false;
            }

            const usesLatestAlias: boolean = r.versions.some(
                v => v === 'latest' || v === '^latest' || v === '~latest'
            );

            if (!usesLatestAlias) {
                return false;
            }

            const previousRoute: RouteWithVersionData | undefined = previousRoutesByKey.get(r.key);
            if (!previousRoute || previousRoute.versions === 'all') {
                return true;
            }

            return !this.routeSupportsVersion(previousRoute, previousLatest.value, previousLatest.value);
        });

        if (routesThatNeedUpdate.length) {
            throw new InitVersioningServiceError(
                [
                    `There are routes that have been used under the previous version "${previousLatest.value}"`,
                    'To continue, you either need to:',
                    '- Define that the route supports the previous version as well as \'latest\'',
                    '- Define that it only supports the previous version and optionally create a separate endpoint for the new version',
                    'This can be done on the @Get/@Post etc. decorators or on the @Controller/@WebsocketController decorators',
                    '',
                    'Affected routes/websocket events:',
                    ...routesThatNeedUpdate.map(r => `- ${r.key}`)
                ]
            );
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveVersion(context: HttpRequestContext | WebsocketRequestContext): Promise<Version> {
        if (context.has(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_VERSION)) {
            return await context.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_VERSION);
        }

        const versionValue: string | undefined = context instanceof WebsocketRequestContext
            ? context.connection?.resolvedVersion.value ?? context.request.headers?.[this.versionHeader]
            : context.request.query[this.versionQueryParam] ?? context.request.headers?.[this.versionHeader];

        try {
            if (versionValue == undefined) {
                const latest: VersionFile | undefined = this.versionFiles.find(v => v.endsAt == undefined);
                if (!latest) {
                    throw new BadRequestError($ts`No active version found`);
                }
                return latest;
            }
            if (isDate(versionValue)) {
                return this.resolveVersionForDate(new Date(versionValue), this.versionFiles);
            }
            const res: VersionFile | undefined = this.versionFiles.find(v => v.value === versionValue);
            if (!res) {
                throw new BadRequestError($ts`Version "${versionValue}" not found`);
            }
            return res;
        }
        catch (error) {
            if (error instanceof BadRequestError) {
                throw error;
            }
            throw new BadRequestError($ts`Could not resolve version`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    findOverlappingVersions(
        a: SupportedVersionsOptions,
        b: SupportedVersionsOptions,
        currentLatest: SemVerVersion
    ): SupportedVersionsOptions {
        if (a === 'all' || b === 'all') {
            return 'all';
        }

        const resolvedA: SemVerMatcher[] = a.map(v => this.versionMatcherToSemVerMatcher(v, currentLatest));
        const resolvedB: SemVerMatcher[] = b.map(v => this.versionMatcherToSemVerMatcher(v, currentLatest));

        return resolvedA.filter(v => SemVerUtilities.matches(v, resolvedB));
    }

    private versionMatcherToSemVerMatcher(version: VersionMatcher, currentLatest: SemVerVersion): SemVerMatcher {
        if (version === 'latest') {
            return currentLatest;
        }
        if (version === '^latest') {
            return `^${currentLatest}`;
        }
        if (version === '~latest') {
            return `~${currentLatest}`;
        }

        return version;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    hasOverlappingVersions(
        a: SupportedVersionsOptions,
        b: SupportedVersionsOptions,
        currentLatest: SemVerVersion
    ): boolean {
        const result: SupportedVersionsOptions = this.findOverlappingVersions(a, b, currentLatest);
        return result === 'all' || !!result.length;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    matchesVersion(versions: SupportedVersionsOptions, resolvedVersion: Version): boolean {
        if (versions === 'all') {
            return true;
        }

        const latest: VersionFile | undefined = this.versionFiles.find(v => v.endsAt == undefined);
        if (!latest) {
            throw new BadRequestError($ts`No active version found`);
        }
        const resolvedMatchers: SemVerMatcher[] = versions.map(
            v => this.versionMatcherToSemVerMatcher(v, latest.value)
        );

        return SemVerUtilities.matches(resolvedVersion.value, resolvedMatchers);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getVersions(): VersionFile[] {
        return this.versionFiles;
    }

    private resolveVersionForDate(date: Date, allVersions: VersionFile[]): Version {
        const res: VersionFile | undefined = allVersions.find(v => {
            return (new Date(v.startsAt).getTime() <= date.getTime())
                && (v.endsAt == undefined || new Date(v.endsAt).getTime() > date.getTime());
        });
        if (!res) {
            throw new BadRequestError($ts`No version active at date, ${$f.date(date)}`);
        }
        return res;
    }

    private routeSupportsVersion(
        route: RouteWithVersionData,
        version: SemVerVersion,
        latestContext: SemVerVersion
    ): boolean {
        if (route.versions === 'all') {
            return true;
        }

        const resolved: SemVerMatcher[] = route.versions.map(v => this.versionMatcherToSemVerMatcher(v, latestContext));

        return SemVerUtilities.matches(version, resolved);
    }

    private getAllRoutes(app: ZibriApplication): RouteWithVersionData[] {
        const allRoutes: RouteWithVersionData[] = [
            ...this.router.manuallyRegisteredRoutes.map(r => ({ key: `${r.httpMethod} ${r.route}`, versions: r.versions })),
            ...app.options.controllers.flatMap(c => {
                const controllerData: ControllerData | undefined = MetadataUtilities.getControllerData(c);
                if (!controllerData) {
                    throw new InitVersioningServiceError(`Could not resolve controller data for ${c.name}`);
                }
                const routes: ControllerRouteConfiguration[] = MetadataUtilities.getControllerRoutes(c);
                return routes.map(r => ({
                    versions: r.versions ?? controllerData.versions,
                    key: controllerData.baseRoute === '/'
                        ? `${r.httpMethod} ${r.route}`
                        : `${r.httpMethod} ${controllerData.baseRoute}${r.route}`
                }));
            }),
            ...app.options.websocketControllers.flatMap(c => {
                const controllerData: WebsocketControllerData | undefined = MetadataUtilities.getWebsocketControllerData(c);
                if (!controllerData) {
                    throw new InitVersioningServiceError(`Could not resolve controller data for ${c.name}`);
                }
                const routes: WebsocketControllerRouteConfiguration[] = MetadataUtilities.getWebsocketControllerRoutes(c);
                return routes.map(r => ({
                    versions: r.versions ?? controllerData.versions,
                    key: `${controllerData.eventPrefix}${r.event}`
                }));
            })
        ];
        return allRoutes;
    }
}