import { randomInt, randomUUID } from 'node:crypto';
import type { ConnectionOptions } from 'node:tls';

import type { Client, ClientOptions, Entry, Filter } from 'ldapts';

import { DisabledLdapEntriesCronJob } from './disabled-ldap-entries.cron-job.ts';
import { LdapCredentials } from './ldap-credentials.model.ts';
import { LdapEntry } from './ldap-entry.model.ts';
import { LdapIdentity, LdapIdentityCreateData } from './ldap-identity.model.ts';
import { LdapServiceAccount } from './ldap-service-account.model.ts';
import { Ldapts } from './ldapts.type.ts';
import { ZibriApplication } from '../../../application/application.ts';
import { Repository } from '../../../data-source/repository/repository.ts';
import { Transaction } from '../../../data-source/transaction/transaction.model.ts';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { AccountDeactivatedError } from '../../../error-handling/errors/account-deactivated.error.ts';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error.ts';
import { InternalError } from '../../../error-handling/internal-error.model.ts';
import { type LeaseServiceInterface } from '../../../leases/lease-service.interface.ts';
import { $ts } from '../../../localization/translate.function.ts';
import { type LoggerInterface } from '../../../logging/logger.interface.ts';
import { KeysetPage } from '../../../open-api/pagination-result.model.ts';
import { Newable } from '../../../types/newable.type.ts';
import { Ms } from '../../../utilities/ms.ts';
import { optionalPeer } from '../../../utilities/optional-peer.function.ts';
import { validateEntitiesRegistered } from '../../../utilities/validate-entities-registered.function.ts';
import { type AuthServiceInterface } from '../../auth-service.interface.ts';
import { Authentication } from '../../models/authentication.model.ts';
import { BaseUser } from '../../models/base-user.model.ts';
import { type UserServiceInterface } from '../../user/user-service.interface.ts';
import { AuthControllerAuthenticatorInterface } from '../auth-controller-authenticator.interface.ts';
import { RefreshResolvingAuthenticatorInterface } from '../refresh-resolving-authenticator.interface.ts';

/**
 * How long a first sign-in may take to link an entry, before another sign-in as the same entry stops
 * waiting for it.
 */
const FIRST_SIGN_IN_LEASE_IN_MS: number = 30 * Ms.SECOND;

/**
 * How many linked entries one search of the job that looks for disabled entries asks for.
 */
const DISABLED_ENTRY_PAGE_SIZE: number = 100;

/**
 * The value of OpenLDAP's `pwdAccountLockedTime` that locks an account until an administrator unlocks
 * it, rather than for a while after too many wrong passwords.
 */
const LOCKED_BY_ADMINISTRATOR: string = '000001010000Z';

/**
 * The attribute list that asks for no attributes at all (RFC 4511, 4.5.1.8): only the names of the
 * entries found.
 */
const NO_ATTRIBUTES: string[] = ['1.1'];

/**
 * Authenticates a user by the password of their entry in a directory, such as OpenLDAP, 389 Directory
 * Server or Active Directory.
 *
 * Extend it once for every directory. The service account finds the entry the typed name belongs to,
 * and a bind as that entry checks the password. The connection is always encrypted: `ldaps://`, or
 * `ldap://` upgraded with StartTLS.
 *
 * An entry is linked to a user by the id the directory gave it. The first sign-in as an entry hands
 * it to `resolveFirstSignIn`, which answers the user it signs in as; every later one hands it to
 * `resolveSignIn` with that user, and so does every refresh of a login of that user.
 *
 * A user whose entry is disabled or deleted loses their logins and api keys: at the next refresh, or
 * when `DisabledLdapEntriesCronJob` finds it, every 15 minutes by default.
 */
export abstract class BaseLdapAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> implements AuthControllerAuthenticatorInterface<RoleType, UserType, LdapCredentials>,
    RefreshResolvingAuthenticatorInterface<RoleType, UserType> {
    /**
     * The name of the authenticator, which the links of the directory's entries to users are kept under.
     */
    abstract readonly name: string;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly credentialsModel: Newable<LdapCredentials> = LdapCredentials;

    /**
     * The servers of the directory: `ldaps://host:636`, or `ldap://host:389`, which is upgraded with
     * StartTLS. A sign-in starts at a random one, and moves on to the next when one cannot be reached.
     */
    abstract readonly urls: string[];

    /**
     * The account the entry of a user is searched for with.
     */
    abstract readonly serviceAccount: LdapServiceAccount;

    /**
     * Where in the directory users are searched for, eg. `ou=people,dc=example,dc=com`.
     */
    abstract readonly searchBase: string;

    /**
     * What every entry a user signs in as matches, eg. `(objectClass=inetOrgPerson)`.
     */
    abstract readonly entryFilter: string;

    /**
     * The attributes the typed name is looked for in, eg. `['uid', 'mail']`. Exactly one entry has to
     * match.
     */
    abstract readonly usernameAttributes: string[];

    /**
     * Where in the directory the groups of a user are searched for, eg. `ou=groups,dc=example,dc=com`.
     * Undefined to read no groups, which leaves `groups` of every entry empty.
     */
    abstract readonly groupSearchBase: string | undefined;

    /**
     * What every group matches.
     */
    readonly groupFilter: string = '(objectClass=groupOfNames)';

    /**
     * The attribute of a group that lists its members.
     */
    readonly memberAttribute: string = 'member';

    /**
     * The attribute that holds the id the directory gave an entry, which never changes.
     */
    readonly idAttribute: string = 'entryUUID';

    /**
     * The attributes read from the entry, which the hooks get. All the attributes of the entry by
     * default.
     */
    readonly attributes: string[] = ['*'];

    /**
     * The attributes `isEntryActive` reads, asked for by name since a directory sends some of them only
     * then: 389 Directory Server's `nsAccountLock` and OpenLDAP's `pwdAccountLockedTime` by default.
     */
    readonly entryStateAttributes: string[] = ['nsAccountLock', 'pwdAccountLockedTime'];

    /**
     * The certificates of the authorities the directory's certificate is trusted from, PEM encoded.
     * The ones of the system when empty.
     */
    readonly trustedCertificates: string[] = [];

    /**
     * How long the directory may take to answer, for the connection and for every request on it.
     */
    readonly timeoutInMs: number = 10 * Ms.SECOND;

    private get userService(): UserServiceInterface {
        return inject(ZIBRI_DI_TOKENS.USER_SERVICE);
    }

    private get leaseService(): LeaseServiceInterface {
        return inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
    }

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    private get identityRepository(): Repository<LdapIdentity, LdapIdentityCreateData> {
        return inject(repositoryTokenFor(LdapIdentity));
    }

    private get authService(): AuthServiceInterface {
        return inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    }

    /**
     * Answers the user an entry signs in as, the first time anybody signs in as it: a user created for
     * it, or one found for it. Throw an http error to refuse the sign-in.
     *
     * The entry is linked to the user afterwards, so every later sign-in as it finds the user.
     * @param entry - The entry, with the attributes that were read and its groups.
     * @param transaction - The transaction of the login, if any.
     * @returns The user.
     */
    abstract resolveFirstSignIn(entry: LdapEntry, transaction: Transaction | undefined): Promise<UserType>;

    /**
     * Answers the user of every later sign-in as an entry, from the user it is linked to: updated from
     * the entry, such as its roles from its groups, or as it is. Throw an http error to refuse the
     * sign-in.
     * @param entry - The entry, with the attributes that were read and its groups.
     * @param user - The user the entry is linked to.
     * @param transaction - The transaction of the login, if any.
     * @returns The user the sign-in logs in as.
     */
    abstract resolveSignIn(entry: LdapEntry, user: UserType, transaction: Transaction | undefined): Promise<UserType>;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    init(app: ZibriApplication): void {
        validateEntitiesRegistered(this.constructor.name, app, LdapIdentity);
        const ldapts: Ldapts = this.resolveLdapts();
        if (!this.urls.length) {
            throw new InternalError(`${this.constructor.name} names no server of the directory.`);
        }
        for (const url of this.urls) {
            // there is no setting for a connection in the clear: a bind sends the password as it is
            const protocol: string = new URL(url).protocol;
            if (protocol !== 'ldaps:' && protocol !== 'ldap:') {
                throw new InternalError(`The urls of ${this.constructor.name} have to start with ldaps:// or ldap://, not "${protocol}".`);
            }
        }
        if (!this.usernameAttributes.length) {
            throw new InternalError(`${this.constructor.name} names no attribute to look for the typed name in.`);
        }
        const filters: Record<string, string> = { entryFilter: this.entryFilter, groupFilter: this.groupFilter };
        for (const [setting, filter] of Object.entries(filters)) {
            try {
                ldapts.FilterParser.parseString(filter);
            }
            catch (error) {
                throw new InternalError(`The ${setting} of ${this.constructor.name} is not an LDAP filter.`, { cause: error });
            }
        }
        this.validateName(app);
        if (!app.options.cronJobs.includes(DisabledLdapEntriesCronJob)) {
            app.options.cronJobs.push(DisabledLdapEntriesCronJob);
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async authenticate(credentials: LdapCredentials, transaction: Transaction | undefined): Promise<Authentication<UserType>> {
        // a bind with a name and no password is an unauthenticated bind, which a directory answers with
        // success without checking anything (RFC 4513, 5.1.2)
        if (!credentials.username || !credentials.password) {
            throw new UnauthorizedError($ts`Invalid username or password.`);
        }
        const entry: LdapEntry = await this.resolveEntry(credentials);
        return { user: await this.resolveUser(entry, transaction), authenticatedAt: new Date() };
    }

    /**
     * Answers the user a refresh continues the login of, from the entries linked to them: refused with
     * an AccountDeactivatedError when one of them is disabled or deleted, and handed to `resolveSignIn`
     * otherwise. A user linked to no entry of this directory is answered as they are.
     * @param user - The user of the login.
     * @param transaction - The transaction of the refresh, if any.
     * @returns The user.
     * @throws AccountDeactivatedError when an entry linked to the user is disabled or deleted.
     * @throws InternalError when no server of the directory can be reached.
     */
    async resolveRefreshUser(user: UserType, transaction: Transaction | undefined): Promise<UserType> {
        const links: LdapIdentity[] = await this.identityRepository.findAll({
            where: { directory: this.name, userId: user.id },
            transaction
        });
        if (!links.length) {
            return user;
        }
        const client: Client = await this.resolveServiceConnection();
        try {
            const entries: Map<string, LdapEntry> = await this.findEntriesById(client, links.map(link => link.entryId));
            const disabled: LdapIdentity[] = links.filter(link => !this.isLinkActive(link, entries));
            if (disabled.length) {
                // once the transaction is finished, which the refusal rolls back
                const mark: () => Promise<void> = async () => await this.markDisabled(disabled);
                if (transaction == undefined) {
                    await mark();
                }
                else {
                    transaction.afterFinish(mark);
                }
                throw new AccountDeactivatedError();
            }
            let res: UserType = user;
            // one after the other, since each is handed what the one before answered
            for (const link of links) {
                const entry: LdapEntry | undefined = entries.get(link.entryId);
                if (entry != undefined) {
                    res = await this.resolveSignIn(await this.resolveWithGroups(client, entry), res, transaction);
                }
            }
            return res;
        }
        finally {
            await client.unbind();
        }
    }

    /**
     * Ends the logins and api keys of the users whose entries were disabled or deleted, and marks their
     * links, so the next run leaves them be. `DisabledLdapEntriesCronJob` calls it.
     */
    async endAccessOfDisabledEntries(): Promise<void> {
        // connected once there is something to ask, so a directory nobody signed in at is never asked
        let client: Client | undefined;
        try {
            let cursor: string | undefined;
            do {
                const page: KeysetPage<LdapIdentity> = await this.identityRepository.findAllAfter(
                    cursor,
                    DISABLED_ENTRY_PAGE_SIZE,
                    // eslint-disable-next-line unicorn/no-null
                    { where: { directory: this.name, disabledAt: null } }
                );
                if (page.items.length) {
                    client ??= await this.resolveServiceConnection();
                    const entries: Map<string, LdapEntry> = await this.findEntriesById(client, page.items.map(link => link.entryId));
                    const disabled: LdapIdentity[] = page.items.filter(link => !this.isLinkActive(link, entries));
                    if (disabled.length) {
                        await this.markDisabled(disabled);
                        const userIds: string[] = [...new Set(disabled.map(link => link.userId))];
                        await Promise.all(userIds.map(async userId => await this.authService.endAccess(userId, undefined)));
                    }
                }
                cursor = page.nextCursor;
            }
            while (cursor != undefined);
        }
        finally {
            await client?.unbind();
        }
    }

    /**
     * Whether an entry may go on signing in, read from the attributes `entryStateAttributes` names: not
     * when 389 Directory Server marks it inactivated, or OpenLDAP's password policy locked it until an
     * administrator unlocks it.
     * @param entry - The entry, with the attributes that were read.
     * @returns Whether it is active.
     */
    protected isEntryActive(entry: LdapEntry): boolean {
        // cspell:disable-next-line
        const inactivated: boolean = (entry.attributes['nsaccountlock'] ?? []).some(value => value.toLowerCase() === 'true');
        // only the lock an administrator sets. One after too many wrong passwords ends by itself, and
        // counting it would let whoever typed them end the logins of the person they were guessing for
        // cspell:disable-next-line
        const locked: boolean = (entry.attributes['pwdaccountlockedtime'] ?? []).includes(LOCKED_BY_ADMINISTRATOR);
        return !inactivated && !locked;
    }

    /**
     * Turns the id an entry is linked by back into the value of the id attribute, which an entry is
     * searched for by. The reverse of `toEntryId`.
     * @param entryId - The id.
     * @returns The value, as the directory holds it.
     */
    protected toEntryIdValue(entryId: string): Buffer {
        return Buffer.from(entryId, 'utf8');
    }

    /**
     * Turns the value of the id attribute into the id an entry is linked by.
     * @param value - The value, as the directory sent it.
     * @returns The id.
     */
    protected toEntryId(value: Buffer): string {
        return value.toString('utf8');
    }

    /**
     * The filter for the entries that have the typed name: one of `usernameAttributes` equal to it.
     * @param username - The typed name.
     * @returns The filter, or undefined when no entry can have the name.
     */
    protected toUsernameFilter(username: string): Filter | undefined {
        const ldapts: Ldapts = this.resolveLdapts();
        return new ldapts.OrFilter({
            filters: this.usernameAttributes.map(attribute => new ldapts.EqualityFilter({ attribute, value: username }))
        });
    }

    /**
     * Finds the groups an entry is a member of below `groupSearchBase`, and the groups those are members
     * of, as deep as they go.
     * @param client - The connection, bound as the service account.
     * @param dn - The entry.
     * @param groupSearchBase - Where the groups are searched for.
     * @returns The distinguished names of the groups.
     */
    protected async resolveGroups(client: Client, dn: string, groupSearchBase: string): Promise<string[]> {
        const ldapts: Ldapts = this.resolveLdapts();
        const groupFilter: Filter = ldapts.FilterParser.parseString(this.groupFilter);
        // by their name in lowercase, so a group that is reached twice, or a loop of groups, ends the search
        const groups: Map<string, string> = new Map();
        // one search for every level of nesting, asking for the groups of all the members found last
        let members: string[] = [dn];
        while (members.length) {
            const { searchEntries } = await client.search(groupSearchBase, {
                scope: 'sub',
                filter: new ldapts.AndFilter({
                    filters: [
                        groupFilter,
                        new ldapts.OrFilter({
                            filters: members.map(member => new ldapts.EqualityFilter({ attribute: this.memberAttribute, value: member }))
                        })
                    ]
                }),
                attributes: NO_ATTRIBUTES
            });
            members = searchEntries.map(group => group.dn).filter(group => !groups.has(group.toLowerCase()));
            for (const group of members) {
                groups.set(group.toLowerCase(), group);
            }
        }
        return [...groups.values()];
    }

    /**
     * Loads `ldapts`.
     * @returns The module.
     */
    protected resolveLdapts(): Ldapts {
        return optionalPeer<Ldapts>('ldapts', 'Sign-in through a directory');
    }

    /**
     * Finds the entry the typed name belongs to, checks the password by binding as it, and finds its
     * groups.
     * @param credentials - What the user typed.
     * @returns The entry.
     * @throws UnauthorizedError when no single entry has the name, or the password is not the entry's.
     */
    private async resolveEntry(credentials: LdapCredentials): Promise<LdapEntry> {
        const client: Client = await this.resolveServiceConnection();
        try {
            const found: Entry | undefined = await this.findEntry(client, credentials.username);
            if (found == undefined) {
                // a bind all the same, so that an unknown name takes as long as a wrong password
                await this.bindAsEntry(client, `cn=${randomUUID()},${this.searchBase}`, credentials.password);
                throw new UnauthorizedError($ts`Invalid username or password.`);
            }
            if (!await this.bindAsEntry(client, found.dn, credentials.password)) {
                throw new UnauthorizedError($ts`Invalid username or password.`);
            }
            if (this.groupSearchBase == undefined) {
                return this.toEntry(found, []);
            }
            // the groups are read as the service account rather than as the user, who may not be allowed
            // to, and only after the password is checked, so a wrong one takes no longer for a known name
            await client.bind(this.serviceAccount.dn, this.serviceAccount.password);
            return this.toEntry(found, await this.resolveGroups(client, found.dn, this.groupSearchBase));
        }
        finally {
            await client.unbind();
        }
    }

    /**
     * Finds the one entry that has the typed name.
     * @param client - The connection, bound as the service account.
     * @param username - The typed name.
     * @returns The entry, or undefined when no entry or more than one has the name.
     */
    private async findEntry(client: Client, username: string): Promise<Entry | undefined> {
        const usernameFilter: Filter | undefined = this.toUsernameFilter(username);
        if (usernameFilter == undefined) {
            return undefined;
        }
        const ldapts: Ldapts = this.resolveLdapts();
        const { searchEntries } = await client.search(this.searchBase, {
            scope: 'sub',
            // built from filter objects rather than text, so nothing in the name is read as a part of the filter
            filter: new ldapts.AndFilter({ filters: [ldapts.FilterParser.parseString(this.entryFilter), usernameFilter] }),
            attributes: [...this.attributes, this.idAttribute],
            // two are enough to know the name is not unique
            sizeLimit: 2
        });
        if (searchEntries.length > 1) {
            this.logger.warn(`${this.constructor.name}: more than one entry has the name a user signed in with.`);
            return undefined;
        }
        return searchEntries[0];
    }

    /**
     * Finds the entries with the given ids, in one search, with the attributes `isEntryActive` reads.
     * @param client - The connection, bound as the service account.
     * @param entryIds - The ids the entries are linked by.
     * @returns The entries found, by their ids, without their groups. An entry missing here was deleted,
     * or no longer matches `entryFilter`.
     */
    private async findEntriesById(client: Client, entryIds: string[]): Promise<Map<string, LdapEntry>> {
        const ldapts: Ldapts = this.resolveLdapts();
        const { searchEntries } = await client.search(this.searchBase, {
            scope: 'sub',
            filter: new ldapts.AndFilter({
                filters: [
                    ldapts.FilterParser.parseString(this.entryFilter),
                    new ldapts.OrFilter({
                        filters: entryIds.map(id => new ldapts.EqualityFilter({
                            attribute: this.idAttribute,
                            value: this.toEntryIdValue(id)
                        }))
                    })
                ]
            }),
            attributes: [...this.attributes, this.idAttribute, ...this.entryStateAttributes]
        });
        const entries: LdapEntry[] = searchEntries.map(found => this.toEntry(found, []));
        return new Map(entries.map(entry => [entry.id, entry]));
    }

    /**
     * Whether the entry of a link was found and is active.
     * @param link - The link.
     * @param entries - The entries found, by their ids.
     * @returns Whether it is.
     */
    private isLinkActive(link: LdapIdentity, entries: Map<string, LdapEntry>): boolean {
        const entry: LdapEntry | undefined = entries.get(link.entryId);
        return entry != undefined && this.isEntryActive(entry);
    }

    /**
     * Marks links whose entries were found disabled or deleted.
     * @param links - The links.
     */
    private async markDisabled(links: LdapIdentity[]): Promise<void> {
        await this.identityRepository.updateAll({ id: { oneOf: links.map(link => link.id) } }, { disabledAt: new Date() });
    }

    /**
     * Adds the groups of an entry, when groups are read at all.
     * @param client - The connection, bound as the service account.
     * @param entry - The entry, without its groups.
     * @returns The entry with its groups.
     */
    private async resolveWithGroups(client: Client, entry: LdapEntry): Promise<LdapEntry> {
        if (this.groupSearchBase == undefined) {
            return entry;
        }
        return { ...entry, groups: await this.resolveGroups(client, entry.dn, this.groupSearchBase) };
    }

    /**
     * Opens an encrypted connection to a server of the directory and binds it as the service account,
     * starting at a random server and moving on to the next while one cannot be reached.
     * @returns The client, bound as the service account.
     * @throws InternalError when no server can be reached, or one refuses the service account.
     */
    private async resolveServiceConnection(): Promise<Client> {
        const ldapts: Ldapts = this.resolveLdapts();
        const start: number = randomInt(this.urls.length);
        const failures: unknown[] = [];
        for (const url of [...this.urls.slice(start), ...this.urls.slice(0, start)]) {
            const client: Client = this.createClient(url);
            try {
                // one at a time on purpose: the next server is only asked once this one failed
                await this.startTls(client, url);
                await client.bind(this.serviceAccount.dn, this.serviceAccount.password);
                return client;
            }
            catch (error) {
                await client.unbind();
                // an answer of the directory comes from a server that was reached, and the next one
                // answers the same
                if (error instanceof ldapts.ResultCodeError) {
                    throw new InternalError(
                        `The service account of ${this.constructor.name} could not bind to the directory.`,
                        { cause: error }
                    );
                }
                this.logger.warn(`${this.constructor.name}: the server ${url} could not be reached.`);
                failures.push(error);
            }
        }
        throw new InternalError(
            `No server of the directory of ${this.constructor.name} could be reached.`,
            { cause: new AggregateError(failures, 'Every server failed to connect.') }
        );
    }

    /**
     * Builds a client for a server, which connects with its first request.
     * @param url - The server.
     * @returns The client.
     */
    private createClient(url: string): Client {
        const ldapts: Ldapts = this.resolveLdapts();
        const options: ClientOptions = { url, timeout: this.timeoutInMs, connectTimeout: this.timeoutInMs };
        // the options of the upgrade go to startTLS rather than to the client, which would otherwise
        // speak TLS from the first byte to a port that expects LDAP
        return new URL(url).protocol === 'ldaps:'
            ? new ldapts.Client({ ...options, tlsOptions: this.getTlsOptions() })
            : new ldapts.Client(options);
    }

    /**
     * Upgrades a connection to an `ldap://` server with StartTLS before anything else is sent. A
     * connection to an `ldaps://` server is encrypted from the first byte already.
     * @param client - The client.
     * @param url - The server.
     */
    private async startTls(client: Client, url: string): Promise<void> {
        const { protocol, hostname } = new URL(url);
        if (protocol === 'ldap:') {
            await client.startTLS({ ...this.getTlsOptions(), host: hostname.replaceAll(/^\[|]$/g, '') });
        }
    }

    private getTlsOptions(): ConnectionOptions {
        return { minVersion: 'TLSv1.2', ca: this.trustedCertificates.length ? this.trustedCertificates : undefined };
    }

    /**
     * Binds as an entry, which checks its password.
     * @param client - The connection.
     * @param dn - The entry.
     * @param password - The password.
     * @returns Whether the directory took the password.
     */
    private async bindAsEntry(client: Client, dn: string, password: string): Promise<boolean> {
        try {
            await client.bind(dn, password);
            return true;
        }
        catch (error) {
            // a disabled, locked or expired account is refused the same way as a wrong password. Which
            // code says so depends on the directory: Active Directory answers every one of them as
            // invalid credentials, 389 Directory Server an inactivated account as unwilling to perform,
            // and a lockout after too many tries is a constraint violation
            const ldapts: Ldapts = this.resolveLdapts();
            if (
                error instanceof ldapts.InvalidCredentialsError
                || error instanceof ldapts.UnwillingToPerformError
                || error instanceof ldapts.ConstraintViolationError
            ) {
                return false;
            }
            throw error;
        }
    }

    /**
     * Reads an entry the way the hooks get it.
     * @param found - The entry, as the search answered it.
     * @param groups - The groups of the entry.
     * @returns The entry.
     * @throws InternalError when the entry has no single id the service account can read.
     */
    private toEntry(found: Entry, groups: string[]): LdapEntry {
        const attributes: Record<string, string[]> = {};
        const idValues: (Buffer | string)[] = [];
        for (const [name, value] of Object.entries(found)) {
            if (name === 'dn') {
                continue;
            }
            const values: (Buffer | string)[] = Array.isArray(value) ? [...value] : [value];
            if (name.toLowerCase() === this.idAttribute.toLowerCase()) {
                idValues.push(...values);
            }
            attributes[name.toLowerCase()] = values.map(v => Buffer.isBuffer(v) ? v.toString('base64') : v);
        }
        const [idValue] = idValues;
        if (idValue == undefined || idValues.length > 1) {
            throw new InternalError(
                `${this.constructor.name}: the entry ${found.dn} has no single "${this.idAttribute}" the service account can read.`
            );
        }
        // text that was valid utf8 turns back into exactly the bytes that were sent
        const id: string = this.toEntryId(Buffer.isBuffer(idValue) ? idValue : Buffer.from(idValue, 'utf8'));
        return { dn: found.dn, id, attributes, groups };
    }

    /**
     * Finds the user an entry is linked to, or links it on the first sign-in.
     * @param entry - The entry.
     * @param transaction - The transaction of the login, if any.
     * @returns The user.
     */
    private async resolveUser(entry: LdapEntry, transaction: Transaction | undefined): Promise<UserType> {
        const linked: LdapIdentity | undefined = await this.findIdentity(entry, transaction);
        if (linked != undefined) {
            if (linked.disabledAt != undefined) {
                // the directory took the password, so the entry is enabled again
                // eslint-disable-next-line unicorn/no-null
                await this.identityRepository.updateById(linked.id, { disabledAt: null }, { transaction });
            }
            return await this.resolveSignIn(entry, await this.findLinkedUser(linked.userId), transaction);
        }
        // two first sign-ins as the same entry at once would each create a user, and only one of them
        // could be linked. The second waits, and finds the link the first made - held until the
        // login's transaction ends, since the link only becomes visible once it commits (10 §10.5)
        const user: UserType | undefined = await this.leaseService.withLease(
            {
                key: `ldap-first-sign-in:${this.name}:${entry.id}`,
                leaseInMs: FIRST_SIGN_IN_LEASE_IN_MS,
                mode: 'wait',
                heldUntil: transaction
            },
            async () => {
                const linkedMeanwhile: LdapIdentity | undefined = await this.findIdentity(entry, transaction);
                if (linkedMeanwhile != undefined) {
                    return await this.resolveSignIn(entry, await this.findLinkedUser(linkedMeanwhile.userId), transaction);
                }
                const created: UserType = await this.resolveFirstSignIn(entry, transaction);
                await this.identityRepository.create({ directory: this.name, entryId: entry.id, userId: created.id }, { transaction });
                return created;
            }
        );
        if (user == undefined) {
            throw new InternalError('The first sign-in as an entry of a directory ended without a user.');
        }
        return user;
    }

    private async findIdentity(entry: LdapEntry, transaction: Transaction | undefined): Promise<LdapIdentity | undefined> {
        return await this.identityRepository.findOne({
            where: { directory: this.name, entryId: entry.id },
            transaction,
            required: false
        });
    }

    private async findLinkedUser(userId: string): Promise<UserType> {
        const user: UserType | undefined = await this.userService.findById<RoleType, UserType, false>(userId, { required: false });
        if (user == undefined) {
            throw new UnauthorizedError($ts`No user is linked to this sign-in.`);
        }
        return user;
    }

    /**
     * Refuses a name another directory has as well, since the links of both would be kept as one.
     * @param app - The application.
     * @throws When the name is not usable.
     */
    private validateName(app: ZibriApplication): void {
        const sharing: string[] = app.options.authenticators
            .filter(authenticator => authenticator.prototype instanceof BaseLdapAuthenticator && inject(authenticator).name === this.name)
            .map(authenticator => authenticator.name);
        if (sharing.length > 1) {
            throw new InternalError(`${sharing.join(', ')} share the name "${this.name}". Every directory needs a name of its own.`);
        }
    }
}