import { Repository } from '../data-source/repository/repository';
import { SpanningTransaction } from '../data-source/transaction/spanning-transaction.model';
import { TransactionUtilities } from '../data-source/transaction/transaction.utilities';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { getDiTokenName } from '../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../di/get-registered-providers-of-variant.function';
import { inject } from '../di/inject.function';
import { type DiVariant, DiVariants } from '../di/models/di-variant.model';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { ConflictError } from '../error-handling/errors/conflict.error';
import { InternalError } from '../error-handling/internal-error.model';
import { HttpStatus } from '../http/http-status.enum';
import { CircuitOpenError } from '../http-client/circuit-open.error';
import { HttpClientError } from '../http-client/http-client.error';
import { type TranslatedString } from '../localization/models/translated-string.model';
import { $ts } from '../localization/translate.function';
import { Ms } from '../utilities/ms';
import { NetworkAddressUtilities } from '../utilities/network-address.utilities';
import { type NewTenantWebDavConnection } from './new-tenant-web-dav-connection.model';
import { NextcloudClient } from './nextcloud/nextcloud-client';
import { type TenantWebDavConnectionChange } from './tenant-web-dav-connection-change.model';
import { type TenantWebDavConnectionServiceInterface } from './tenant-web-dav-connection-service.interface';
import { type TenantWebDavConnectionTest } from './tenant-web-dav-connection-test.model';
import { type TenantWebDavConnectionUsageCleanerInterface } from './tenant-web-dav-connection-usage-cleaner.interface';
import { type TenantWebDavConnectionUsageFinderInterface } from './tenant-web-dav-connection-usage-finder.interface';
import { TenantWebDavConnection } from './tenant-web-dav-connection.model';
import { WebDavClient } from './web-dav-client';
import { WebDavConnectionKind } from './web-dav-connection-kind.enum';
import { type WebDavEntry } from './web-dav-entry.model';
import { WebDavForbiddenError } from './web-dav-forbidden.error';
import { type WebDavTenantConnectionOptions } from './web-dav-tenant-connection-options.model';

/**
 * How long the request a connection is tested with may take: a caller waits for it.
 */
const TEST_TIMEOUT_IN_MS: number = Ms.SECOND * 15;

/**
 * Default implementation of the service managing the connections of the active tenant to WebDAV servers: a connection
 * is tested with a PROPFIND of its folder, and refused for deletion while a usage finder of
 * `DiVariants.WEB_DAV_CONNECTION_USAGE_FINDER` finds it used. Otherwise it is deleted in one transaction with what
 * every usage cleaner of `DiVariants.WEB_DAV_CONNECTION_USAGE_CLEANER` removes.
 */
@Injectable({ register: 'onUse' })
export class TenantWebDavConnectionService implements TenantWebDavConnectionServiceInterface {
    // read when used rather than injected: the entity is declared only by an application whose tenants connect to
    // servers of their own
    private get connectionRepository(): Repository<TenantWebDavConnection> {
        return inject(repositoryTokenFor(TenantWebDavConnection));
    }

    private get tenantConnectionOptions(): WebDavTenantConnectionOptions {
        return inject(ZIBRI_DI_TOKENS.WEB_DAV_TENANT_CONNECTION_OPTIONS);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findConnections(): Promise<TenantWebDavConnection[]> {
        return await this.connectionRepository.findAll({ order: { name: 'ASC', id: 'ASC' }, limit: 'all' });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createConnection(connection: NewTenantWebDavConnection): Promise<TenantWebDavConnection> {
        await this.validateConnection(connection);
        return await this.connectionRepository.create({
            name: connection.name,
            kind: connection.kind,
            url: connection.url,
            username: connection.username,
            password: connection.password
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateConnection(connectionId: string, change: TenantWebDavConnectionChange): Promise<TenantWebDavConnection> {
        const stored: TenantWebDavConnection = await this.connectionRepository.findById(connectionId);
        const changed: TenantWebDavConnectionTest = {
            kind: change.kind ?? stored.kind,
            url: change.url ?? stored.url,
            username: change.username ?? stored.username,
            password: change.password ?? stored.password
        };
        // what logs in, changed: a connection that stops reaching its folder would fail every feature using it later,
        // where nobody sees why. A kind changed to Nextcloud needs a url of one
        if (changed.kind !== stored.kind || changed.url !== stored.url || changed.username !== stored.username || changed.password !== stored.password) {
            await this.validateConnection(changed);
        }
        const data: Partial<Pick<TenantWebDavConnection, 'name' | 'kind' | 'url' | 'username' | 'password'>> = {
            ...change.name === undefined ? {} : { name: change.name },
            ...change.kind === undefined ? {} : { kind: change.kind },
            ...change.url === undefined ? {} : { url: change.url },
            ...change.username === undefined ? {} : { username: change.username },
            ...change.password === undefined ? {} : { password: change.password }
        };
        if (!Object.keys(data).length) {
            return stored;
        }
        return await this.connectionRepository.updateById(connectionId, data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteConnection(connectionId: string): Promise<void> {
        const connection: TenantWebDavConnection = await this.connectionRepository.findById(connectionId);
        const finders: TenantWebDavConnectionUsageFinderInterface[] = TenantWebDavConnectionService.resolveProvidersOfVariant(
            DiVariants.WEB_DAV_CONNECTION_USAGE_FINDER,
            TenantWebDavConnectionService.isUsageFinder,
            'usage finder, and needs to implement TenantWebDavConnectionUsageFinderInterface'
        );
        const usages: TranslatedString[] = (await Promise.all(finders.map(async finder => await finder.findUsages(connection)))).flat();
        // refused rather than cleared: a calendar that names a connection gone writes nothing, without anybody seeing
        // why
        if (usages.length) {
            throw new ConflictError([
                $ts`The WebDAV connection "${connection.name}" is in use, and can be deleted once nothing uses it.`,
                ...usages
            ]);
        }
        const cleaners: TenantWebDavConnectionUsageCleanerInterface[] = TenantWebDavConnectionService.resolveProvidersOfVariant(
            DiVariants.WEB_DAV_CONNECTION_USAGE_CLEANER,
            TenantWebDavConnectionService.isUsageCleaner,
            'usage cleaner, and needs to implement TenantWebDavConnectionUsageCleanerInterface'
        );
        // spanning, as the rows a cleaner removes may be kept in another data source than the connection, which costs
        // nothing extra when they are not
        await TransactionUtilities.runAndCommit(new SpanningTransaction(), async transaction => {
            // one after the other, as the writes of one transaction run over one connection
            for (const cleaner of cleaners) {
                await cleaner.removeUsages(connection, transaction);
            }
            await this.connectionRepository.deleteById(connectionId, { transaction });
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validateConnection(connection: TenantWebDavConnectionTest): Promise<void> {
        const url: URL = this.resolveUrl(connection.url);
        // before the host is looked up: a url of no Nextcloud is refused for what it is, wherever it leads
        const client: WebDavClient = this.createClient(connection);
        await this.validateHost(url);
        let entry: WebDavEntry | undefined;
        try {
            entry = await client.findEntry('');
        }
        catch (error) {
            throw this.resolveTestError(url, error);
        }
        if (entry == undefined) {
            throw new BadRequestError($ts`The url of a WebDAV connection needs to be a folder on the server, and the server has nothing at ${url.href}.`);
        }
        if (entry.kind === 'file') {
            throw new BadRequestError($ts`The url of a WebDAV connection needs to be a folder, and ${url.href} is a file.`);
        }
    }

    /**
     * Creates the client a connection is tested with, of its kind.
     * @param connection - The connection.
     * @returns The client.
     * @throws {BadRequestError} When the url of a connection to a Nextcloud is not below `/remote.php/dav/`.
     */
    private createClient(connection: TenantWebDavConnectionTest): WebDavClient {
        switch (connection.kind) {
            case WebDavConnectionKind.WEB_DAV: {
                return WebDavClient.createForTenant(connection, { timeoutInMs: TEST_TIMEOUT_IN_MS });
            }
            case WebDavConnectionKind.NEXTCLOUD: {
                try {
                    return NextcloudClient.createForTenant(connection, { timeoutInMs: TEST_TIMEOUT_IN_MS });
                }
                catch (error) {
                    throw new BadRequestError(
                        $ts`The url of a Nextcloud connection needs to be below /remote.php/dav/ of the server, such as https://cloud.example.com/remote.php/dav/.`,
                        { cause: error }
                    );
                }
            }
        }
    }

    /**
     * Resolves every provider of a variant, such as `DiVariants.WEB_DAV_CONNECTION_USAGE_FINDER`.
     * @param variant - The variant.
     * @param isOfVariant - Whether a provided value is what the variant takes.
     * @param expected - What a provider of the variant is, and needs to implement, for the error.
     * @returns The provided values.
     * @throws {InternalError} When a provided value is not what the variant takes.
     */
    private static resolveProvidersOfVariant<T>(variant: DiVariant, isOfVariant: (value: unknown) => value is T, expected: string): T[] {
        return getRegisteredProvidersOfVariant(variant).map(provider => {
            const provided: unknown = inject(provider.token);
            if (!isOfVariant(provided)) {
                throw new InternalError(`${getDiTokenName(provider.token)} is provided as a WebDAV connection ${expected}.`);
            }
            return provided;
        });
    }

    /**
     * Whether a value finds where connections are used.
     * @param value - The value.
     * @returns Whether it has a `findUsages`.
     */
    private static isUsageFinder(value: unknown): value is TenantWebDavConnectionUsageFinderInterface {
        return typeof value === 'object' && value != undefined && 'findUsages' in value && typeof value.findUsages === 'function';
    }

    /**
     * Whether a value removes what points at connections that are deleted.
     * @param value - The value.
     * @returns Whether it has a `removeUsages`.
     */
    private static isUsageCleaner(value: unknown): value is TenantWebDavConnectionUsageCleanerInterface {
        return typeof value === 'object' && value != undefined && 'removeUsages' in value && typeof value.removeUsages === 'function';
    }

    /**
     * Resolves the url of a connection.
     * @param url - The url, as the tenant gave it.
     * @returns It, parsed.
     * @throws {BadRequestError} When it is no http or https url, or plain http where the private networks may not be
     * reached.
     */
    private resolveUrl(url: string): URL {
        let parsed: URL;
        try {
            parsed = new URL(url);
        }
        catch {
            throw new BadRequestError($ts`The url of a WebDAV connection needs to be an absolute url, such as https://cloud.example.com/remote.php/dav/.`);
        }
        const allowsPrivateNetworks: boolean = this.tenantConnectionOptions.allowPrivateNetworks;
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:' && allowsPrivateNetworks) {
            return parsed;
        }
        throw new BadRequestError($ts`The url of a WebDAV connection needs to start with https://.`);
    }

    /**
     * Validates that the host of a connection may be reached, before anything is sent to it.
     * @param url - The url of the connection.
     * @throws {BadRequestError} When the host is not allowed, cannot be found, or leads to this machine or a private
     * network.
     */
    private async validateHost(url: URL): Promise<void> {
        const options: WebDavTenantConnectionOptions = this.tenantConnectionOptions;
        try {
            NetworkAddressUtilities.validateAllowedHost(url.hostname, options.allowedHosts);
        }
        catch {
            throw new BadRequestError($ts`The host of a WebDAV connection needs to be one your application allows, and ${url.hostname} is not.`);
        }
        if (options.allowPrivateNetworks) {
            return;
        }
        try {
            await NetworkAddressUtilities.resolvePublicAddress(url.hostname, options.allowedHosts);
        }
        catch (error) {
            if (error instanceof InternalError) {
                throw new BadRequestError($ts`The host of a WebDAV connection needs to lead to public addresses only, and ${url.hostname} does not.`);
            }
            throw new BadRequestError($ts`The host ${url.hostname} of the WebDAV connection cannot be found.`, { cause: error });
        }
    }

    /**
     * Resolves what a failed test of a connection is refused with.
     * @param url - The url of the connection.
     * @param error - What the request failed with.
     * @returns The error to throw.
     */
    private resolveTestError(url: URL, error: unknown): unknown {
        if (error instanceof WebDavForbiddenError) {
            return new BadRequestError($ts`The user of the WebDAV connection needs to be allowed to read the folder at ${url.href}.`, { cause: error });
        }
        if (error instanceof CircuitOpenError || error instanceof HttpClientError && error.responseData == undefined) {
            return new BadRequestError($ts`The WebDAV server at ${url.origin} cannot be reached.`, { cause: error });
        }
        if (error instanceof HttpClientError) {
            const status: number = error.responseData?.status ?? 0;
            if (status === HttpStatus.UNAUTHORIZED) {
                return new BadRequestError($ts`The WebDAV server refused the username or the password.`, { cause: error });
            }
            // a server that answers, but with no listing of a folder: a web page, or a WebDAV server that refuses
            return new BadRequestError($ts`The url of a WebDAV connection needs to be a folder of a WebDAV server, and ${url.href} answered with ${String(status)}.`, { cause: error });
        }
        // a redirect to a host that may not be reached, or an answer about another folder
        if (error instanceof InternalError) {
            return new BadRequestError($ts`The url of a WebDAV connection needs to be a folder of a WebDAV server, and ${url.href} is none.`, { cause: error });
        }
        return error;
    }
}
