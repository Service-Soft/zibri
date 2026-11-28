import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, RecordingEmailTransport } from 'zibri-testing';

import { compileTsxTemplate } from '../../__testing__/compile-tsx-template.function';
import { TestTimeouts, testFileFolder } from '../../__testing__/constants';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../__testing__/mocks/entities/roles.enum';
import { TestInvitation } from '../../__testing__/mocks/entities/test-invitation.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { TestServerInvitationRepository } from '../../__testing__/test-server/invitation-repository';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../__testing__/wait-until.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { EmailConfigInput } from '../../email/models/email-config.model';
import { Email } from '../../email/models/email.model';
import { KnownHeader } from '../../http/known-header.enum';
import { MimeType } from '../../http/mime-type.enum';
import { defineDateFormat } from '../../localization/define-date-format.function';
import { LocalizeService } from '../../localization/localize.service';
import { LocaleConfiguration } from '../../localization/models/localize-options.model';
import { runInLocale } from '../../localization/run-in-locale.function';
import { generateSourceXlf } from '../../localization/xlf/generate-source-xlf.function';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { Newable } from '../../types/newable.type';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { OtpTwoFactorMethod } from '../2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../auth-controller/auth-controller.model';
import { PasswordResetEmailTemplate } from '../authenticators/password/password-reset-email-template.model';
import { PasswordAuthenticator } from '../authenticators/password/password.authenticator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { InvitationEmailTemplate } from '../invitation/invitation-email-template.model';
import { InvitationOptions } from '../invitation/invitation-options.model';
import { JwtAuthStrategy } from '../strategies/jwt/jwt.auth-strategy';

/**
 * A user has a locale, which they are created in and can change, and the mails of the framework reach them in it,
 * whichever locale the request sending one asks for.
 */

const workDir: FsPath = FsUtilities.getPath(testFileFolder, 'user-locale');
const translationsDir: FsPath = FsUtilities.getPath(workDir, 'translations');

const english: LocaleConfiguration = {
    currencyCode: 'USD',
    defaultDateFormat: defineDateFormat('MM/DD/YYYY'),
    defaultDateTimeFormat: defineDateFormat('MM/DD/YYYY h:mm A'),
    defaultTimeFormat: defineDateFormat('h:mm A')
};

const german: LocaleConfiguration = {
    currencyCode: 'EUR',
    defaultDateFormat: defineDateFormat('DD.MM.YYYY'),
    defaultDateTimeFormat: defineDateFormat('DD.MM.YYYY HH:mm'),
    defaultTimeFormat: defineDateFormat('HH:mm')
};

const PASSWORD: string = 'correct horse battery staple';

const transport: RecordingEmailTransport = new RecordingEmailTransport();

let server: StartedTestServer | undefined;
let baseUrl: string;

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, TestInvitation],
    repositories: [...defaultTestServerRepositories, TestServerInvitationRepository]
});

/**
 * The auth routes of the suite, with those answering invitations.
 */
@Controller('/auth', { allowOrphan: true, versions: 'all' })
class LocaleTestAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [PasswordAuthenticator],
        twoFactorMethods: [OtpTwoFactorMethod],
        invitationRoutes: true
    }) {}

/**
 * The sign up route of the application, which creates a user the way its own code does.
 */
@Controller('/sign-up')
class SignUpController {
    @Post()
    async signUp(): Promise<{ id: string }> {
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: newEmail(), roles: [Roles.USER] });
        return { id: user.id };
    }
}

function newEmail(): string {
    return `${UUIDUtilities.generate()}@locale.example.com`;
}

function users(): Repository<JwtUser> {
    return inject(repositoryTokenFor(JwtUser));
}

/**
 * Reads the last mail sent to an email.
 * @param email - The email.
 * @returns The mail.
 */
async function readLastMail(email: string): Promise<Email> {
    await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).sendQueuedEmails();
    const mail: Email | undefined = transport.sends.filter(sent => sent.recipients.includes(email)).at(-1);
    if (mail == undefined) {
        throw new Error(`Nothing was mailed to ${email}.`);
    }
    return mail;
}

/**
 * Posts to a route of the server.
 * @param path - The path.
 * @param body - The body.
 * @param acceptLanguage - The locale the request asks for.
 * @returns The answer.
 */
async function post(path: string, body: object, acceptLanguage: string = 'en-US'): Promise<Response> {
    return await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { [KnownHeader.CONTENT_TYPE]: MimeType.JSON, [KnownHeader.ACCEPT_LANGUAGE]: acceptLanguage },
        body: JSON.stringify(body)
    });
}

describe('the locale of a user', () => {
    beforeAll(async () => {
        await FsUtilities.createFile(FsUtilities.getPath(workDir, 'src', 'strings.ts'), ['export const welcome = () => $t`Welcome`;']);
        await generateSourceXlf(workDir, [{ origin: 'project', originLocale: 'en-US', patterns: `${workDir}/src/**/*.ts` }]);
        // the subjects of the mails are the German zibri ships, the templates say this
        await FsUtilities.createFile(FsUtilities.getPath(translationsDir, 'de.xlf'), [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2">',
            '  <file source-language="en-US" target-language="de" datatype="plaintext" original="project">',
            '    <body>',
            '      <trans-unit id="Welcome" xml:space="preserve">',
            '        <source>Welcome</source>',
            '        <target>Willkommen</target>',
            '      </trans-unit>',
            '    </body>',
            '  </file>',
            '</xliff>'
        ]);
        const invitationOptions: InvitationOptions = {
            acceptInvitationUrl: 'https://app.example.com/invitation',
            invitationEmail: compileTsxTemplate<InvitationEmailTemplate>(
                'export const Email = ({ link }) => <a href={link}>{$ts`Welcome`}</a>;'
            ),
            tokenExpiresInMs: 60000,
            onExpiredToken: 'refuse'
        };

        server = await startTestServer({
            dataSources: [dataSourceClass],
            authStrategies: [JwtAuthStrategy],
            authenticators: [PasswordAuthenticator],
            twoFactorMethods: [OtpTwoFactorMethod],
            controllers: [LocaleTestAuthController, SignUpController],
            providers: [
                ...defaultTestServerProviders,
                // the repository's test servers skip the localize service's startup, which reads the translations
                defineProvider({ token: ZIBRI_DI_TOKENS.LOCALIZE_SERVICE, useClass: LocalizeService }),
                defineProvider({ token: ZIBRI_DI_TOKENS.TRANSLATIONS_PATH, useValue: translationsDir }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT,
                    useValue: { defaultLocale: 'en-US', supportedLocales: { 'en-US': english, de: german } }
                }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.PASSWORD_RESET_EMAIL_TEMPLATE,
                    useValue: compileTsxTemplate<PasswordResetEmailTemplate<string, JwtUser>>(
                        'export const Email = ({ confirmPasswordResetLink }) => <a href={confirmPasswordResetLink}>{$ts`Welcome`}</a>;'
                    )
                }),
                defineProvider({ token: ZIBRI_DI_TOKENS.INVITATION_OPTIONS, useValue: invitationOptions }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
                    useFactory: (): EmailConfigInput => ({ maxEmailsPerHour: 1000, defaultSender: 'Ada', failedRetentionInMs: 'forever' })
                }),
                defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: transport })
            ]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        await FsUtilities.rm(workDir);
    }, TestTimeouts.inMemory.shutdown);

    describe('creating a user', () => {
        it('gives a user created by a request the locale it asks for', async () => {
            const res: Response = await post('/sign-up', {}, 'de-AT,de;q=0.9,en;q=0.5');
            expect(res.ok).toBe(true);
            const { id } = await res.json() as { id: string };

            expect(await users().findById(id)).toMatchObject({ locale: 'de' });
        });

        it('gives a user created outside a request the default locale, and one created in a locale that one', async () => {
            const outside: JwtUser = await users().create({ email: newEmail(), roles: [Roles.USER] });
            const inGerman: JwtUser = await runInLocale('de', async () => await users().create({ email: newEmail(), roles: [Roles.USER] }));

            expect([outside.locale, inGerman.locale]).toEqual(['en-US', 'de']);
        });

        it('keeps the locale a user is created with', async () => {
            const user: JwtUser = await users().create({ email: newEmail(), roles: [Roles.USER], locale: 'de' });

            expect(user.locale).toBe('de');
        });
    });

    describe('changing it', () => {
        it('stores a supported locale, and null for the default one', async () => {
            const user: JwtUser = await users().create({ email: newEmail(), roles: [Roles.USER] });

            await inject(ZIBRI_DI_TOKENS.USER_SERVICE).updateLocale?.(user.id, 'de', undefined);
            expect(await users().findById(user.id)).toMatchObject({ locale: 'de' });

            await inject(ZIBRI_DI_TOKENS.USER_SERVICE).updateLocale?.(user.id, null, undefined);
            expect(await users().findById(user.id)).toMatchObject({ locale: null });
        });

        it('refuses a locale the application does not support, and keeps the one the user has', async () => {
            const user: JwtUser = await users().create({ email: newEmail(), roles: [Roles.USER], locale: 'de' });

            await expect(inject(ZIBRI_DI_TOKENS.USER_SERVICE).updateLocale?.(user.id, 'fr', undefined))
                .rejects.toThrow('The locale needs to be one of en-US, de.');
            // a locale of a supported language is not the one supported
            await expect(inject(ZIBRI_DI_TOKENS.USER_SERVICE).updateLocale?.(user.id, 'de-AT', undefined)).rejects.toThrow();
            expect(await users().findById(user.id)).toMatchObject({ locale: 'de' });
        });
    });

    describe('the mails of the framework', () => {
        it('mail a password reset in the locale of the user, not in the one of the request', async () => {
            const email: string = newEmail();
            await users().create({ email, roles: [Roles.USER], locale: 'de' });

            expect((await post('/auth/request-password-reset', { email }, 'en-US')).status).toBe(204);
            await waitUntil(async () => {
                await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).sendQueuedEmails();
                return transport.sends.some(sent => sent.recipients.includes(email));
            });

            const mail: Email = await readLastMail(email);
            expect(mail.subject).toBe('Passwort zurücksetzen');
            expect(mail.html).toContain('Willkommen');
        });

        it('mail a password reset of a user without a locale in the default locale', async () => {
            const email: string = newEmail();
            await users().create({ email, roles: [Roles.USER], locale: null });

            expect((await post('/auth/request-password-reset', { email }, 'de')).status).toBe(204);
            await waitUntil(async () => {
                await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).sendQueuedEmails();
                return transport.sends.some(sent => sent.recipients.includes(email));
            });

            expect(await readLastMail(email)).toMatchObject({ subject: 'Password Reset' });
        });
    });

    describe('an invitation', () => {
        /**
         * Somebody inviting to the application, who needs no permission to hand out no role.
         * @returns The caller.
         */
        async function createCaller(): Promise<CurrentUser> {
            const user: JwtUser = await users().create({ email: newEmail(), roles: [Roles.USER] });
            return { id: user.id, email: user.email, deactivatedAt: user.deactivatedAt, permissions: [], platformPermissions: [] };
        }

        /**
         * Invites somebody to the application, and reads the token off the mail that was sent.
         * @param data - The locale it is sent in, if any.
         * @returns The invitation, the token and the mail.
         */
        async function invite(data: Partial<Pick<TestInvitation, 'createOn' | 'locale'>>): Promise<{ invitation: TestInvitation, token: string, mail: Email }> {
            const invitation: TestInvitation = await inject(ZIBRI_DI_TOKENS.INVITATION_SERVICE).invite<TestInvitation>(await createCaller(), {
                name: 'Ada',
                email: newEmail(),
                tenantId: undefined,
                roles: [],
                createOn: data.createOn ?? 'accept',
                declinable: true,
                expiresInMs: undefined,
                ...data.locale == undefined ? {} : { locale: data.locale }
            }, undefined);
            const mail: Email = await readLastMail(invitation.email);
            const token: string | undefined = /invitation\/([\da-f]+)/.exec(mail.html)?.[1];
            if (token == undefined) {
                throw new Error(`No invitation was mailed to ${invitation.email}.`);
            }
            return { invitation, token, mail };
        }

        it('is mailed in the locale it is sent in, and creates the account in it', async () => {
            const { invitation, token, mail } = await invite({ locale: 'de' });

            expect(invitation.locale).toBe('de');
            expect(mail.subject).toBe('Einladung');
            expect(mail.html).toContain('Willkommen');

            // accepted by a request asking for another locale
            expect((await post('/auth/accept-invitation', { token, password: PASSWORD }, 'en-US')).status).toBe(204);
            expect(await users().findOne({ where: { email: invitation.email } })).toMatchObject({ locale: 'de' });
        });

        it('creates the account as it is sent in the locale it is sent in, rather than in the one of the inviter', async () => {
            const { invitation } = await runInLocale('en-US', async () => await invite({ locale: 'de', createOn: 'invite' }));

            expect(await users().findOne({ where: { email: invitation.email } })).toMatchObject({ locale: 'de' });
        });

        it('is mailed in the locale of the request sending it, without one of its own', async () => {
            const { invitation, mail } = await runInLocale('de', async () => await invite({}));

            expect([invitation.locale, mail.subject]).toEqual(['de', 'Einladung']);
        });

        it('gives the account the locale the person accepting chose', async () => {
            const { invitation, token } = await invite({ locale: 'de' });

            expect((await post('/auth/accept-invitation', { token, password: PASSWORD, locale: 'en-US' })).status).toBe(204);
            expect(await users().findOne({ where: { email: invitation.email } })).toMatchObject({ locale: 'en-US' });
        });

        it('refuses a locale the application does not support, and creates no account', async () => {
            const { invitation, token } = await invite({ locale: 'de' });

            expect((await post('/auth/accept-invitation', { token, password: PASSWORD, locale: 'fr' })).status).toBe(400);
            expect(await users().findOne({ where: { email: invitation.email }, required: false })).toBeUndefined();
        });
    });
});