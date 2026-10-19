import { randomBytes, X509Certificate } from 'node:crypto';

import { ApiKeyAuthenticationMethod } from './api-key-authentication-method.enum';
import { ApiKeyCleanupCronJob } from './api-key-cleanup.cron-job';
import { ApiKeyClientAuthentication } from './api-key-client-authentication.model';
import { ApiKeyCreateData } from './api-key-create-data.model';
import { ApiKeyOptions } from './api-key-options.model';
import { ApiKeyServiceInterface } from './api-key-service.interface';
import { ApiKey, ApiKeyCreateDto } from './api-key.model';
import { CreatedApiKey } from './created-api-key.model';
import { ZibriApplication } from '../../../application/application';
import { Repository } from '../../../data-source/repository/repository';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { $ts } from '../../../localization/translate.function';
import { BaseMembership } from '../../../tenancy/membership/base-membership.model';
import { type MembershipServiceInterface } from '../../../tenancy/membership/membership-service.interface';
import { validateRequestTenant } from '../../../tenancy/validate-request-tenant.function';
import { Ms } from '../../../utilities/ms';
import { UrlUtilities } from '../../../utilities/url.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { validateEntitiesRegistered } from '../../../utilities/validate-entities-registered.function';
import { type HashServiceInterface } from '../../hash/hash-service.interface';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy';
import { BaseUser } from '../../models/base-user.model';
import { type UserServiceInterface } from '../../user/user-service.interface';
import { JwtUtilities } from '../jwt/jwt.utilities';

/**
 * What every api key starts with.
 */
export const API_KEY_PREFIX: string = 'zibri_';

/**
 * What an api key without a secret stores of what it proves itself with.
 */
type ApiKeyClientColumns = Pick<ApiKeyCreateDto, 'authenticationMethod' | 'publicKey' | 'jwksUrl' | 'certificateThumbprint'>;

/**
 * The columns of an api key that is a secret, which proves itself with nothing else.
 */
const SECRET_COLUMNS: ApiKeyClientColumns = {
    authenticationMethod: ApiKeyAuthenticationMethod.SECRET,
    publicKey: undefined,
    jwksUrl: undefined,
    certificateThumbprint: undefined
};

/**
 * Default implementation of the service keeping the api keys of the users.
 */
@Injectable({ register: 'onUse' })
export class ApiKeyService implements ApiKeyServiceInterface {
    /**
     * Whether something in the application reads api keys.
     */
    private read: boolean = false;

    // read when used rather than injected, so that an application without api keys never resolves them
    private get apiKeyRepository(): Repository<ApiKey, ApiKeyCreateDto> {
        if (!this.read) {
            // a key nothing reads is a secret handed out for nothing
            throw new InternalError([
                'Api keys are read by nothing in this application.',
                'Register a strategy reading them, such as ApiKeyAuthStrategy, or declare an AuthorizationServerController.'
            ]);
        }
        return inject(repositoryTokenFor(ApiKey));
    }

    private get userService(): UserServiceInterface {
        return inject(ZIBRI_DI_TOKENS.USER_SERVICE);
    }

    private get hashService(): HashServiceInterface {
        return inject(ZIBRI_DI_TOKENS.HASH_SERVICE);
    }

    private get membershipService(): MembershipServiceInterface {
        return inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    registerReader(app: ZibriApplication, reader: string): void {
        validateEntitiesRegistered(reader, app, ApiKey);
        this.read = true;
        for (const [name, value] of Object.entries(inject(ZIBRI_DI_TOKENS.API_KEY_OPTIONS))) {
            if (value != undefined && (!Number.isInteger(value) || value < 0)) {
                throw new InternalError(`API_KEY_OPTIONS.${name} must be a whole number of milliseconds, got ${value}.`);
            }
        }
        if (!app.options.cronJobs.includes(ApiKeyCleanupCronJob)) {
            app.options.cronJobs.push(ApiKeyCleanupCronJob);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async create<Role extends string>(
        userId: string,
        data: ApiKeyCreateData<Role, undefined>,
        transaction: Transaction | undefined
    ): Promise<CreatedApiKey> {
        await this.validateApiKey(userId, data);
        // 256 random bits: nothing to guess, and no two keys alike. The prefix tells a key sent as a
        // bearer token apart from a jwt, and lets a secret scanner find one that leaked
        const key: string = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
        const apiKey: ApiKey = await this.apiKeyRepository.create(
            {
                userId,
                name: data.name,
                value: key,
                roles: data.roles,
                tenantId: data.tenantId,
                expiresAt: data.expiresAt,
                requireDpop: data.requireDpop,
                ...SECRET_COLUMNS
            },
            { transaction }
        );
        return { apiKey, key };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createClient<Role extends string>(
        userId: string,
        data: ApiKeyCreateData<Role, ApiKeyClientAuthentication>,
        transaction: Transaction | undefined
    ): Promise<ApiKey> {
        await this.validateApiKey(userId, data);
        return await this.apiKeyRepository.create(
            {
                userId,
                name: data.name,
                value: undefined,
                roles: data.roles,
                tenantId: data.tenantId,
                expiresAt: data.expiresAt,
                requireDpop: data.requireDpop,
                ...this.toClientColumns(data.clientAuthentication)
            },
            { transaction }
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findForUser(userId: string, transaction: Transaction | undefined): Promise<ApiKey[]> {
        return await this.apiKeyRepository.findAll({ where: { userId }, order: { createdAt: 'ASC' }, take: 'all', transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findActiveByKey(key: string): Promise<ApiKey | undefined> {
        // hashed to be searched for, because that is how it is stored
        const apiKey: ApiKey | undefined = await this.apiKeyRepository.findOne({
            where: { value: await this.hashService.hash(key, { strategy: Sha256HashStrategy }) },
            required: false
        });
        return this.isActive(apiKey) ? apiKey : undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findActiveById(id: string): Promise<ApiKey | undefined> {
        // an id that is no uuid names no key, and is not handed to a store that would refuse it
        const apiKey: ApiKey | undefined = UUIDUtilities.isUuid(id)
            ? await this.apiKeyRepository.findOne({ where: { id }, required: false })
            : undefined;
        return this.isActive(apiKey) ? apiKey : undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revoke(userId: string, apiKeyId: string, transaction: Transaction | undefined): Promise<void> {
        const apiKey: ApiKey = await this.apiKeyRepository.findOne({ where: { id: apiKeyId, userId }, transaction });
        await this.apiKeyRepository.deleteById(apiKey.id, { transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async revokeForUser(userId: string, transaction: Transaction | undefined): Promise<void> {
        // a user of an application without api keys holds none
        if (!this.read) {
            return;
        }
        await this.apiKeyRepository.deleteAll({ userId }, { transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async recordUse(apiKey: ApiKey): Promise<void> {
        const now: Date = new Date();
        // written down once in a while rather than on every request: the time only has to tell a key
        // nobody uses from one an integration depends on, and a write per request is what it would cost
        if (
            apiKey.lastUsedAt != undefined
            && now.getTime() - new Date(apiKey.lastUsedAt).getTime() < this.resolveOptions().recordUseAfterMs
        ) {
            return;
        }
        // by a filter rather than by id, so that a key revoked since it was read is no error
        await this.apiKeyRepository.updateAll({ id: apiKey.id }, { lastUsedAt: now });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteExpired(): Promise<void> {
        const expiredBefore: Date = new Date(Date.now() - this.resolveOptions().deleteExpiredAfterMs);
        await this.apiKeyRepository.deleteAll({ expiresAt: { before: expiredBefore } });
    }

    /**
     * The api key options, with the defaults for what the application leaves out.
     * @returns The options.
     */
    private resolveOptions(): Required<ApiKeyOptions> {
        const options: ApiKeyOptions = inject(ZIBRI_DI_TOKENS.API_KEY_OPTIONS);
        return {
            recordUseAfterMs: options.recordUseAfterMs ?? Ms.HOUR,
            deleteExpiredAfterMs: options.deleteExpiredAfterMs ?? Ms.DAY * 30
        };
    }

    /**
     * Whether an api key was found and has not expired.
     * @param apiKey - The key, if one was found.
     * @returns True while it may be used.
     */
    private isActive(apiKey: ApiKey | undefined): apiKey is ApiKey {
        return apiKey != undefined && (apiKey.expiresAt == undefined || new Date(apiKey.expiresAt).getTime() > Date.now());
    }

    /**
     * Refuses an api key that cannot be created.
     * @param userId - The id of the user the key acts as.
     * @param data - The key.
     * @throws A BadRequestError when the name is empty, the user lacks one of the roles, or the key
     * would have expired already.
     */
    private async validateApiKey<Role extends string>(userId: string, data: ApiKeyCreateData<Role>): Promise<void> {
        if (!data.name.trim()) {
            throw new BadRequestError($ts`An api key needs a name.`);
        }
        if (data.expiresAt != undefined && data.expiresAt.getTime() <= Date.now()) {
            throw new BadRequestError($ts`An api key cannot expire in the past.`);
        }
        const user: BaseUser<string> = await this.userService.findById(userId);
        const membershipRoles: string[] = await this.resolveMembershipRoles(userId, data.tenantId);
        const missing: Role[] = data.roles.filter(role => !user.roles.includes(role) && !membershipRoles.includes(role));
        if (missing.length) {
            throw new BadRequestError($ts`The user does not have the roles ${missing.join(', ')}.`);
        }
    }

    /**
     * Resolves the roles a user holds through their memberships, as far as a key may use them.
     * @param userId - The user.
     * @param tenantId - The tenant the key is bound to, or undefined for a key acting in all of them.
     * @returns The roles of the user's membership in that tenant, or of every membership of theirs.
     * @throws A BadRequestError when the key is bound to a tenant that is not a uuid, or that the user
     * is no member of.
     */
    private async resolveMembershipRoles(userId: string, tenantId: string | undefined): Promise<string[]> {
        if (tenantId == undefined) {
            const memberships: BaseMembership<string>[] = await this.membershipService.findMemberships(userId);
            return memberships.flatMap(membership => membership.roles);
        }
        // the caller's mistake, the same as a request naming such a tenant
        validateRequestTenant(tenantId);
        const membership: BaseMembership<string> | undefined = await this.membershipService.findMembership(userId, tenantId);
        if (membership == undefined) {
            // a key bound to a tenant its user cannot act in would be refused on every request
            throw new BadRequestError($ts`The user is no member of the tenant "${tenantId}".`);
        }
        return membership.roles;
    }

    /**
     * What an api key without a secret stores of what it proves itself with.
     * @param authentication - How it proves itself.
     * @returns The columns.
     * @throws A BadRequestError when the public key, the url or the certificate cannot be used.
     */
    private toClientColumns(authentication: ApiKeyClientAuthentication): ApiKeyClientColumns {
        switch (authentication.method) {
            case ApiKeyAuthenticationMethod.PRIVATE_KEY_JWT: {
                if ('jwksUrl' in authentication) {
                    return {
                        ...SECRET_COLUMNS,
                        authenticationMethod: authentication.method,
                        jwksUrl: this.validateJwksUrl(authentication.jwksUrl)
                    };
                }
                try {
                    // stored as PEM whichever way it came, so that one form is read back
                    const pem: string | Buffer = JwtUtilities.resolveClientKey(authentication.publicKey)
                        .export({ type: 'spki', format: 'pem' });
                    return { ...SECRET_COLUMNS, authenticationMethod: authentication.method, publicKey: pem.toString() };
                }
                catch (error) {
                    throw new BadRequestError(
                        $ts`The public key of an api key has to be an EC, Ed25519 or RSA key, PEM encoded or as a JSON Web Key.`,
                        { cause: error }
                    );
                }
            }
            case ApiKeyAuthenticationMethod.TLS_CLIENT_AUTH: {
                return { ...SECRET_COLUMNS, authenticationMethod: authentication.method };
            }
            case ApiKeyAuthenticationMethod.SELF_SIGNED_TLS_CLIENT_AUTH: {
                try {
                    const certificate: X509Certificate = new X509Certificate(authentication.certificate);
                    return {
                        ...SECRET_COLUMNS,
                        authenticationMethod: authentication.method,
                        certificateThumbprint: JwtUtilities.resolveCertificateThumbprint(certificate)
                    };
                }
                catch (error) {
                    throw new BadRequestError($ts`The certificate of an api key has to be PEM encoded.`, { cause: error });
                }
            }
        }
    }

    /**
     * Refuses the url of a JSON Web Key Set that anybody between could change on its way.
     * @param url - The url.
     * @returns The url.
     * @throws A BadRequestError when it is no url, or neither https nor on the loopback interface.
     */
    private validateJwksUrl(url: string): string {
        if (!URL.canParse(url) || !UrlUtilities.isPrivate(new URL(url))) {
            throw new BadRequestError($ts`The JSON Web Key Set of an api key has to be at an https url.`);
        }
        return url;
    }
}