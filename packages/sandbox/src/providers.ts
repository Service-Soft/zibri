import { AesGcmEncryptionStrategy, CompanyInfo, defineDateFormat, defineProvider, DiProvider, EmailConfigInput, GlobalRegistry, inject, JwtAuthOptionsInput, LoggerTransport, LoggingEmailTransport, LogLevel, Ms, repositoryTokenFor, SmtpEmailTransport, ZIBRI_DI_TOKENS, ZIBRI_INVOICING_PLUGIN_DI_TOKENS, ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from 'zibri';

import { optionalEnv, requireEnv, requirePortEnv, requireUrlEnv } from './env';
import { permissions, Tenant } from './models';
import { MailingListBaseEmail } from './templates/email-components/mailing-list-base-email';
import { MailingListSubscribeConfirmationEmail } from './templates/emails/mailing-list-subscribe-confirmation';
import { PasswordResetEmail } from './templates/emails/password-reset';
import { ErrorPage } from './templates/pages/error';
import { MailingListPreferencesPage } from './templates/pages/mailing-list-preferences';
import { MailingListUnsubscribeConfirmationPage } from './templates/pages/mailing-list-unsubscribe-confirmation';
import { SubscribeSuccessPage } from './templates/pages/subscribe-success';

export const providers: DiProvider<unknown>[] = [
    defineProvider({
        token: ZIBRI_DI_TOKENS.ERROR_PAGE_TEMPLATE,
        useFactory: () => ErrorPage
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.LOGGER_TRANSPORTS,
        useFactory: () => [LoggerTransport.console(LogLevel.INFO)]
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS,
        useValue: {
            currentMasterStrategy: new AesGcmEncryptionStrategy(),
            currentMasterKey: {
                id: 'k1',
                value: requireEnv('MASTER_KEY')
            }
        }
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.PASSWORD_RESET_EMAIL_TEMPLATE,
        useFactory: () => PasswordResetEmail
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT,
        useFactory: (): JwtAuthOptionsInput => ({
            accessTokenKey: requireEnv('JWT_ACCESS_SECRET'),
            refreshTokenSecret: requireEnv('JWT_REFRESH_SECRET')
        })
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.PERMISSIONS,
        useValue: permissions
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
        useFactory: (): EmailConfigInput => {
            return {
                maxEmailsPerHour: 0,
                defaultSender: optionalEnv('EMAIL_DEFAULT_SENDER'),
                failedRetentionInMs: 'forever'
            };
        }
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT,
        // in development every mail is logged instead of sent, see the email docs
        useFactory: () => GlobalRegistry.getAppData('environment') === 'development'
            ? new LoggingEmailTransport()
            : new SmtpEmailTransport({
                host: requireEnv('SMTP_HOST'),
                port: requirePortEnv('SMTP_PORT'),
                auth: {
                    user: optionalEnv('SMTP_USER'),
                    pass: optionalEnv('SMTP_PASSWORD')
                }
            })
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS,
        useValue: 'forever'
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.THREAD_JOB_RETENTION_IN_MS,
        useValue: 'forever'
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS,
        useValue: Ms.DAY * 365
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.CONFIRM_PASSWORD_RESET_URL,
        useFactory: () => requireUrlEnv('CONFIRM_PASSWORD_RESET_URL')
    }),
    defineProvider({
        // the OpenAPI explorer open to everyone, whatever defaultAuth says. Remove this to put it behind defaultAuth
        token: ZIBRI_DI_TOKENS.OPEN_API_AUTH,
        useValue: { skip: true }
    }),
    defineProvider({
        token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.PREFERENCES_PAGE_TEMPLATE,
        useFactory: () => MailingListPreferencesPage
    }),
    defineProvider({
        token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE,
        useFactory: () => MailingListUnsubscribeConfirmationPage
    }),
    defineProvider({
        token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_CONFIRMATION_EMAIL_TEMPLATE,
        useFactory: () => MailingListSubscribeConfirmationEmail
    }),
    defineProvider({
        token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.BASE_EMAIL_TEMPLATE,
        useFactory: () => MailingListBaseEmail
    }),
    defineProvider({
        token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_SUCCESS_PAGE_TEMPLATE,
        useFactory: () => SubscribeSuccessPage
    }),
    defineProvider({
        token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.COMPANY_INFO_SERVICE,
        useValue: {
            // an invoice is issued by the tenant it was written in
            resolveCompanyInfo: async (tenantId: string): Promise<CompanyInfo> => {
                const tenant: Tenant = await inject(repositoryTokenFor(Tenant)).findById(tenantId);
                return {
                    address: {
                        street: '',
                        number: '',
                        postcode: '',
                        city: '',
                        countryId: ''
                    },
                    name: tenant.name,
                    fullName: tenant.name,
                    email: '',
                    phone: '',
                    timezone: 'UTC'
                };
            }
        }
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT,
        useValue: {
            defaultLocale: 'en-US',
            supportedLocales: {
                'en-US': {
                    currencyCode: 'USD',
                    defaultDateFormat: defineDateFormat('MM/DD/YYYY'),
                    defaultDateTimeFormat: defineDateFormat('MM/DD/YYYY h:mm A'),
                    defaultTimeFormat: defineDateFormat('h:mm A')
                }
                // de: {
                //     currencyCode: 'EUR',
                //     defaultDateFormat: defineDateFormat('DD.MM.YYYY'),
                //     defaultDateTimeFormat: defineDateFormat('DD.MM.YYYY HH:mm'),
                //     defaultTimeFormat: defineDateFormat('HH:mm')
                // }
            }
        }
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,
        // how long a client may be away and still be sent what it missed
        useValue: { messageRetentionInMs: Ms.DAY }
    })
];