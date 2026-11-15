import assert from 'node:assert';

import { beforeAll, describe, expect, it } from '@jest/globals';

import { FederatedIdentity, FederatedIdentityCreateData } from './authenticators/federated/federated-identity.model';
import { OAuthProviderTokens, OAuthProviderTokensCreateData } from './authenticators/oauth/oauth-provider-tokens.model';
import { PasswordCredentials, PasswordCredentialsCreateData } from './authenticators/password/password-credentials.model';
import { ApiKey } from './strategies/api-key/api-key.model';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { StartedTestServer } from '../__testing__/test-server/start-test-server.function';
import { BackupDigest } from '../backup/backup-digest.model';
import { BackupEncryptionUtilities } from '../backup/backup-encryption.utilities';
import { BackupEntity } from '../backup/backup-entity.model';
import { BackupServiceInterface } from '../backup/backup-service.interface';
import { KeptUserRowsUtilities } from '../backup/kept-user-rows.utilities';
import { RestoreJournalUtilities } from '../backup/restore-journal.utilities';
import { StagedFile } from '../backup/staged-file.model';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { Newable } from '../types/newable.type';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

const PASSWORD: string = 'correct horse battery staple';
const BACKUP_PASSWORD: string = 'the password of the backup';

/**
 * Where the server answers, once the cases started it.
 */
let baseUrl: string;

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

function getCredentials(): Repository<PasswordCredentials, PasswordCredentialsCreateData> {
    return inject(repositoryTokenFor(PasswordCredentials));
}

async function takeBackup(): Promise<BackupEntity> {
    return await getBackupService().waitForBackup(await getBackupService().queueBackup({ name: `auth-${UUIDUtilities.generate()}` }));
}

/**
 * Creates a user who logs in with a password.
 * @param name - What sets the user's email apart.
 * @param password - The password.
 * @returns The user.
 */
async function createUser(name: string, password: string = PASSWORD): Promise<JwtUser> {
    const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({
        email: `${name}@restore.test`,
        roles: [Roles.USER]
    });
    await getCredentials().create({ userId: user.id, password });
    return user;
}

/**
 * Sets the password of a user.
 * @param user - The user.
 * @param password - The new password.
 */
async function setPassword(user: JwtUser, password: string): Promise<void> {
    await getCredentials().deleteAll({ userId: user.id });
    await getCredentials().create({ userId: user.id, password });
}

/**
 * Logs a user in over http.
 * @param user - The user.
 * @param password - The password sent.
 * @returns The response.
 */
async function login(user: JwtUser, password: string = PASSWORD): Promise<Response> {
    return await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email: user.email, password })
    });
}

/**
 * Logs a user in over http.
 * @param user - The user.
 * @returns The refresh token.
 */
async function loginRefreshToken(user: JwtUser): Promise<string> {
    const res: Response = await login(user);
    expect(res.status).toBe(200);
    // eslint-disable-next-line typescript/no-unsafe-assignment
    const body: { refreshToken: { value: string } } = await res.json();
    return body.refreshToken.value;
}

async function refreshLogin(refreshToken: string): Promise<number> {
    const res: Response = await fetch(`${baseUrl}/auth/refresh-login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ refreshToken })
    });
    return res.status;
}

async function logout(refreshToken: string): Promise<void> {
    const res: Response = await fetch(`${baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ refreshToken })
    });
    expect(res.status).toBe(200);
}

/**
 * Creates an api key of a user.
 * @param user - The user.
 * @param name - The name of the key.
 * @returns The key.
 */
async function createApiKey(user: JwtUser, name: string): Promise<ApiKey> {
    const { apiKey } = await inject(ZIBRI_DI_TOKENS.API_KEY_SERVICE).create(
        user.id,
        { name, permissions: [], tenantId: undefined, expiresAt: undefined, clientAuthentication: undefined, requireDpop: false },
        undefined
    );
    return apiKey;
}

/**
 * Links an identity at a provider to a user.
 * @param user - The user.
 * @param subject - Who the user is at the provider.
 * @returns The identity.
 */
async function linkIdentity(user: JwtUser, subject: string): Promise<FederatedIdentity> {
    const identities: Repository<FederatedIdentity, FederatedIdentityCreateData> = inject(repositoryTokenFor(FederatedIdentity));
    return await identities.create({ issuer: 'https://provider.example.com', subject: `${subject}-${UUIDUtilities.generate()}`, userId: user.id, forLogin: true, grantedScopes: [] });
}

async function findApiKeyNames(user: JwtUser): Promise<string[]> {
    return (await inject(repositoryTokenFor(ApiKey)).findAll({ where: { userId: user.id } })).map(k => k.name).sort();
}

/**
 * What a restore of the application does to logging in: the logins and the credentials of the users that
 * exist when it begins stay as they are, so that nothing revoked since the backup works again, and nothing
 * created since stops working.
 * @param name - The data source, in the name of the suite.
 * @param getServer - The server, booted but not started, with one data source marked with `@Backup`
 * holding the users, their credentials, `ApiKey`, `FederatedIdentity` and `OAuthProviderTokens`, the jwt and
 * api key strategies, and `JwtTestAuthController`.
 * @param dataSourceClass - That data source.
 */
export function describeLoginsAcrossRestore(
    name: string,
    getServer: () => StartedTestServer | undefined,
    dataSourceClass: Newable<DataSourceInterface>
): void {
    describe(`AuthService - logging in across a restore of the application, on ${name}`, () => {
        beforeAll(async () => {
            const server: StartedTestServer | undefined = getServer();
            assert(server, 'the server did not start');
            baseUrl = await server.start();
        });

        it('keeps a login started since the backup', async () => {
            const user: JwtUser = await createUser(`started-${UUIDUtilities.generate()}`);
            const backup: BackupEntity = await takeBackup();
            const refreshToken: string = await loginRefreshToken(user);

            await getBackupService().restore(backup);

            expect(await refreshLogin(refreshToken)).toBe(200);
        }, 30000);

        it('keeps a login ended since the backup ended', async () => {
            const user: JwtUser = await createUser(`ended-${UUIDUtilities.generate()}`);
            const refreshToken: string = await loginRefreshToken(user);
            const backup: BackupEntity = await takeBackup();
            await logout(refreshToken);

            await getBackupService().restore(backup);

            expect(await refreshLogin(refreshToken)).toBe(401);
        }, 30000);

        it('logs a user in with the password set since the backup, and not with the one before', async () => {
            const user: JwtUser = await createUser(`changed-${UUIDUtilities.generate()}`, BACKUP_PASSWORD);
            const backup: BackupEntity = await takeBackup();
            await setPassword(user, 'the password set since');

            await getBackupService().restore(backup);

            expect((await login(user, 'the password set since')).status).toBe(200);
            expect((await login(user, BACKUP_PASSWORD)).status).toBe(401);
        }, 30000);

        it('keeps an api key revoked since the backup revoked, and one created since', async () => {
            const user: JwtUser = await createUser(`keys-${UUIDUtilities.generate()}`);
            const revoked: ApiKey = await createApiKey(user, 'revoked since');
            await createApiKey(user, 'kept');
            const backup: BackupEntity = await takeBackup();
            await inject(ZIBRI_DI_TOKENS.API_KEY_SERVICE).revoke(user.id, revoked.id, undefined);
            await createApiKey(user, 'created since');

            await getBackupService().restore(backup);

            expect(await findApiKeyNames(user)).toEqual(['created since', 'kept']);
        }, 30000);

        it('keeps the tokens a provider issued for an identity since the backup, and none of one unlinked since', async () => {
            const user: JwtUser = await createUser(`provider-${UUIDUtilities.generate()}`);
            const kept: FederatedIdentity = await linkIdentity(user, 'kept');
            const unlinked: FederatedIdentity = await linkIdentity(user, 'unlinked since');
            const tokens: Repository<OAuthProviderTokens, OAuthProviderTokensCreateData> = inject(repositoryTokenFor(OAuthProviderTokens));
            await tokens.createAll([
                {
                    identityId: kept.id,
                    accessToken: 'issued before the backup',
                    refreshToken: undefined,
                    accessTokenExpirationDate: undefined
                },
                {
                    identityId: unlinked.id,
                    accessToken: 'of the identity unlinked since',
                    refreshToken: undefined,
                    accessTokenExpirationDate: undefined
                }
            ]);
            const backup: BackupEntity = await takeBackup();
            await tokens.updateAll({ identityId: kept.id }, { accessToken: 'issued since' });
            await tokens.deleteAll({ identityId: unlinked.id });
            await inject(repositoryTokenFor(FederatedIdentity)).deleteById(unlinked.id);

            await getBackupService().restore(backup);

            expect((await tokens.findAll({ where: { identityId: { oneOf: [kept.id, unlinked.id] } } })).map(t => t.accessToken))
                .toEqual(['issued since']);
        }, 30000);

        it('restores the credentials of a user the database lacks, as onto a fresh database', async () => {
            const user: JwtUser = await createUser(`lacked-${UUIDUtilities.generate()}`);
            await createApiKey(user, 'of the backup');
            const backup: BackupEntity = await takeBackup();
            await getCredentials().deleteAll({ userId: user.id });
            await inject(repositoryTokenFor(ApiKey)).deleteAll({ userId: user.id });
            await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).deleteById(user.id);

            await getBackupService().restore(backup);

            expect((await login(user)).status).toBe(200);
            expect(await findApiKeyNames(user)).toEqual(['of the backup']);
        }, 30000);

        it('writes back at the next start the credentials a restore that was killed may not have written back', async () => {
            const server: StartedTestServer | undefined = getServer();
            assert(server, 'the server did not start');
            const user: JwtUser = await createUser(`killed-${UUIDUtilities.generate()}`, 'the password of now');
            const stagingFolder: FsPath = inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER);
            await FsUtilities.mkdir(stagingFolder);
            // what a process killed once the data source was replaced, and before the credentials were written
            // back, leaves: a journal naming the kept rows, and a data source holding those of the backup
            const kept: StagedFile = {
                path: FsUtilities.getPath(stagingFolder, `killed-${UUIDUtilities.generate()}-user-rows`),
                compression: 'zstd',
                encryption: BackupEncryptionUtilities.generateStagedFileEncryption()
            };
            const streamUserIds: (() => AsyncIterable<string>) | undefined = inject(ZIBRI_DI_TOKENS.USER_SERVICE).streamUserIds;
            assert(streamUserIds, 'the user service streams no user ids');
            const digest: BackupDigest = await KeptUserRowsUtilities.stage(
                inject(dataSourceClass),
                streamUserIds.call(inject(ZIBRI_DI_TOKENS.USER_SERVICE)),
                kept
            );
            await RestoreJournalUtilities.write(RestoreJournalUtilities.getPath(stagingFolder, UUIDUtilities.generate()), {
                backupName: 'killed before the credentials were written back',
                applied: [],
                keptUserRows: [
                    await RestoreJournalUtilities.resolveEntry(
                        dataSourceClass.name,
                        kept,
                        digest,
                        inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE)
                    )
                ]
            });
            await setPassword(user, BACKUP_PASSWORD);

            await server.reInit();
            baseUrl = await server.start();

            expect((await login(user, 'the password of now')).status).toBe(200);
            expect(await RestoreJournalUtilities.findPaths(stagingFolder)).toEqual([]);
            expect(await FsUtilities.exists(kept.path)).toBe(false);
        }, 60000);
    });
}