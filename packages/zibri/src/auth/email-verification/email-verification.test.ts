import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { compileTsxTemplate } from '../../__testing__/compile-tsx-template.function';
import { TestTimeouts } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../__testing__/wait-until.function';
import { AuditEntry } from '../../audit/audit-entry.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { Email } from '../../email/models/email.model';
import { EmailNotVerifiedError } from '../../error-handling/errors/email-not-verified.error';
import { KnownHeader } from '../../http/known-header.enum';
import { MimeType } from '../../http/mime-type.enum';
import { AuditAction } from '../../logging/audit-event.model';
import { RateLimitStateEntity } from '../../rate-limiting/stores/rate-limit-state-entity.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { JsonUtilities } from '../../utilities/json.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { EmailTwoFactorMethod } from '../2fa/methods/code/email.two-factor-method';
import { TwoFactorCodeCredentials } from '../2fa/methods/code/two-factor-code-credentials.model';
import { TwoFactorCode } from '../2fa/methods/code/two-factor-code.model';
import { AuthController } from '../auth-controller/auth-controller.model';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../authenticators/password/password-credentials.model';
import { PasswordAuthenticator } from '../authenticators/password/password.authenticator';
import { PasswordResetToken } from '../models/password-reset-token.model';
import { JwtAuthStrategy } from '../strategies/jwt/jwt.auth-strategy';
import { EmailChangedEmailTemplate } from './email-changed-email-template.model';
import { EmailVerificationEmailTemplate } from './email-verification-email-template.model';
import { type EmailVerificationOptions } from './email-verification-options.model';
import { type EmailVerificationServiceInterface } from './email-verification-service.interface';
import { EmailVerificationToken } from './email-verification-token.model';

const PASSWORD: string = 'correct horse battery staple';

@Controller('/auth', { versions: 'all' })
class VerifyingAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [PasswordAuthenticator],
        twoFactorMethods: [EmailTwoFactorMethod],
        emailVerification: true,
        confirmEmailRoute: true
    }) {}

let server: StartedTestServer | undefined;
let baseUrl: string;

/**
 * The users of the running application.
 * @returns Their repository.
 */
function users(): Repository<JwtUser> {
    return inject(repositoryTokenFor(JwtUser));
}

/**
 * Creates a user with a password.
 * @param verified - Whether their address is verified.
 * @returns The user.
 */
async function createUser(verified: boolean): Promise<JwtUser> {
    const user: JwtUser = await users().create({
        email: `${UUIDUtilities.generate()}@verify.test`,
        roles: [Roles.USER],
        emailVerifiedAt: verified ? new Date() : null
    });
    await inject<Repository<PasswordCredentials, PasswordCredentialsCreateData>>(repositoryTokenFor(PasswordCredentials))
        .create({ userId: user.id, password: PASSWORD });
    return user;
}

/**
 * Logs in with a password.
 * @param email - The address.
 * @returns The response.
 */
async function login(email: string): Promise<Response> {
    return await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
        body: JsonUtilities.stringify({ email, password: PASSWORD })
    });
}

/**
 * Posts json to an auth route.
 * @param path - The route below `/auth`.
 * @param body - What is sent.
 * @param accessToken - The access token to send, if any.
 * @returns The status of the answer.
 */
async function post(path: string, body: object, accessToken?: string): Promise<number> {
    const res: Response = await fetch(`${baseUrl}/auth${path}`, {
        method: 'POST',
        headers: {
            [KnownHeader.CONTENT_TYPE]: MimeType.JSON,
            ...accessToken == undefined ? {} : { [KnownHeader.AUTHORIZATION]: `Bearer ${accessToken}` }
        },
        body: JsonUtilities.stringify(body)
    });
    await res.arrayBuffer();
    return res.status;
}

/**
 * The mails sent to an address.
 * @param address - The address.
 * @returns The mails.
 */
async function findMails(address: string): Promise<Email[]> {
    return await inject(repositoryTokenFor(Email)).findAll({ where: { recipients: { includes: [address] } } });
}

/**
 * The token of the last verification link mailed to an address.
 * @param address - The address.
 * @returns The token.
 */
async function findMailedToken(address: string): Promise<string> {
    const token: string | undefined = /verify-email\/([\w-]+)/.exec((await findMails(address)).at(-1)?.html ?? '')?.[1];
    expect(token).toBeDefined();
    return token ?? '';
}

const verificationOptions: EmailVerificationOptions = {
    confirmEmailUrl: 'https://app.example.com/verify-email',
    verificationEmail: compileTsxTemplate<EmailVerificationEmailTemplate>('export const Email = ({ link }) => <a href={link}></a>;'),
    emailChangedEmail: compileTsxTemplate<EmailChangedEmailTemplate>('export const Email = ({ newEmail }) => <p>{newEmail}</p>;'),
    requiredForLogin: true
};

// an address was never verified, so a reset link or a second factor by email went to whatever
// a user typed, and changing it was the application's to write
describe('Verifying the email address of a user', () => {
    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, EmailVerificationToken, TwoFactorCodeCredentials, TwoFactorCode, RateLimitStateEntity],
                    repositories: defaultTestServerRepositories,
                    // orphan allowed, since each suite of the file declares a class of its own
                    allowOrphan: true
                })
            ],
            authStrategies: [JwtAuthStrategy],
            twoFactorMethods: [EmailTwoFactorMethod],
            controllers: [VerifyingAuthController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_OPTIONS, useValue: verificationOptions })
            ]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('refuses a password login until the address is verified, and mails a link to verify it', async () => {
        const user: JwtUser = await createUser(false);

        const refused: Response = await login(user.email);
        expect(refused.status).toBe(403);
        expect(await post('/confirm-email-verification', { token: await findMailedToken(user.email) })).toBe(204);

        expect((await login(user.email)).status).toBe(200);
        expect((await users().findById(user.id)).emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('changes the address once the new one confirms it, and tells the previous one', async () => {
        const user: JwtUser = await createUser(true);
        const loggedIn: { accessToken: { value: string } } = await (await login(user.email)).json() as { accessToken: { value: string } };
        const newEmail: string = `${UUIDUtilities.generate()}@verify.test`;

        // a login of the last minutes, which a change of address asks for like linking an identity does
        expect(await post('/request-email-change', { newEmail }, loggedIn.accessToken.value)).toBe(204);
        expect((await users().findById(user.id)).email).toBe(user.email);
        expect(await post('/confirm-email-change', { token: await findMailedToken(newEmail) })).toBe(204);

        const changed: JwtUser = await users().findById(user.id);
        expect(changed.email).toBe(newEmail);
        expect(changed.emailVerifiedAt).toBeInstanceOf(Date);
        expect((await findMails(user.email)).some(mail => mail.html.includes(newEmail))).toBe(true);
        await inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).flush();
        expect(await inject(repositoryTokenFor(AuditEntry)).count({ where: { action: AuditAction.EMAIL_CHANGED, userId: user.id }, acrossTenants: true }))
            .toBe(1);
    });

    it('confirms any link at /confirm-email, and with previousAddressConfirms changes an address once both addresses confirmed', async () => {
        // the options the server was started with, switched on for this test only
        const options: EmailVerificationOptions | undefined = inject(ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_OPTIONS);
        if (options == undefined) {
            throw new Error('The server verifies email addresses.');
        }
        const confirm: (token: string) => Promise<unknown> = async token => {
            const res: Response = await fetch(`${baseUrl}/auth/confirm-email`, {
                method: 'POST',
                headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON },
                body: JsonUtilities.stringify({ token })
            });
            expect(res.status).toBe(200);
            return await res.json() as unknown;
        };
        const unverified: JwtUser = await createUser(false);
        expect((await login(unverified.email)).status).toBe(403);
        expect(await confirm(await findMailedToken(unverified.email))).toEqual({ purpose: 'verification', completed: true });

        options.previousAddressConfirms = true;
        try {
            const user: JwtUser = await createUser(true);
            const loggedIn: { accessToken: { value: string } } = await (await login(user.email)).json() as { accessToken: { value: string } };
            const newEmail: string = `${UUIDUtilities.generate()}@verify.test`;
            expect(await post('/request-email-change', { newEmail }, loggedIn.accessToken.value)).toBe(204);

            // the previous address approves first, which alone changes nothing: the new one is not proven yet
            expect(await confirm(await findMailedToken(user.email))).toEqual({ purpose: 'change', completed: false });
            expect((await users().findById(user.id)).email).toBe(user.email);
            expect(await confirm(await findMailedToken(newEmail))).toEqual({ purpose: 'change', completed: true });
            expect((await users().findById(user.id)).email).toBe(newEmail);
        }
        finally {
            options.previousAddressConfirms = false;
        }
    });

    it('sends a password reset link to a verified address only', async () => {
        const unverified: JwtUser = await createUser(false);
        const verified: JwtUser = await createUser(true);

        expect(await post('/request-password-reset', { email: unverified.email })).toBe(204);
        expect(await post('/request-password-reset', { email: verified.email })).toBe(204);

        const resetTokens: Repository<PasswordResetToken> = inject(repositoryTokenFor(PasswordResetToken));
        await waitUntil(async () => (await resetTokens.findAll({ where: { userId: verified.id } })).length === 1);
        await inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).flush();
        await waitUntil(async () => await inject(repositoryTokenFor(AuditEntry))
            .count({ where: { action: AuditAction.PASSWORD_RESET_REQUESTED, subject: unverified.email }, acrossTenants: true }) === 1);
        expect(await resetTokens.findAll({ where: { userId: unverified.id } })).toHaveLength(0);
    });

    it('sends no code to an address that is not verified', async () => {
        const unverified: JwtUser = await createUser(false);
        const verified: JwtUser = await createUser(true);
        const method: EmailTwoFactorMethod = inject(EmailTwoFactorMethod);

        await expect(inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE).requestTwoFactorRegistration(unverified, method, undefined))
            .rejects.toThrow(EmailNotVerifiedError);
        await inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE).requestTwoFactorRegistration(verified, method, undefined);
        expect(await findMails(verified.email)).toHaveLength(1);
    });

    it('refuses changing an address around it without saying whether the new one is verified', async () => {
        const user: JwtUser = await createUser(true);

        // otherwise the verification of the old address would stand for the new one
        await expect(users().updateById(user.id, { email: `${UUIDUtilities.generate()}@verify.test` })).rejects.toThrow(/emailVerifiedAt/);
        await users().updateById(user.id, { email: `${UUIDUtilities.generate()}@verify.test`, emailVerifiedAt: null });
        await users().updateById(user.id, { roles: [Roles.ADMIN] });
    });
});

/**
 * A service of an application's own, as 3.0 had it implement: without `confirmEmail`. What it would do is never
 * reached, since the application refuses to start.
 */
const threeZeroEmailVerificationService: EmailVerificationServiceInterface = {
    isEnabled: true,
    isRequiredForLogin: false,
    requestEmailVerification: async () => await Promise.reject(new Error('not reached')),
    confirmEmailVerification: async () => await Promise.reject(new Error('not reached')),
    requestEmailChange: async () => await Promise.reject(new Error('not reached')),
    confirmEmailChange: async () => await Promise.reject(new Error('not reached')),
    validateEmailVerified: () => undefined,
    deleteUserRows: async () => await Promise.reject(new Error('not reached'))
};

describe('POST /confirm-email with a service that cannot confirm any link', () => {
    it('refuses to start, naming what the service lacks', async () => {
        const refused: StartedTestServer = await startTestServer({
            dataSources: [
                createInMemoryDataSource({
                    entities: [...defaultTestServerEntities, EmailVerificationToken, TwoFactorCodeCredentials, TwoFactorCode, RateLimitStateEntity],
                    repositories: defaultTestServerRepositories,
                    // orphan allowed, since each suite of the file declares a class of its own
                    allowOrphan: true
                })
            ],
            authStrategies: [JwtAuthStrategy],
            twoFactorMethods: [EmailTwoFactorMethod],
            controllers: [VerifyingAuthController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_OPTIONS, useValue: verificationOptions }),
                defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_SERVICE, useValue: threeZeroEmailVerificationService })
            ]
        });

        try {
            await expect(refused.start()).rejects.toThrow(
                'VerifyingAuthController defines POST /confirm-email, and the EmailVerificationService has no confirmEmail.'
            );
        }
        finally {
            // a start the application refuses still leaves it initialized
            await refused.shutdown();
        }
    }, TestTimeouts.inMemory.start);
});