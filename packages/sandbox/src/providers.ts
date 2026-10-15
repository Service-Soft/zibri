import { AesGcmEncryptionStrategy, CompanyInfo, defineDateFormat, defineProvider, DiProvider, EmailConfigInput, inject, JwtAuthOptionsInput, LoggerTransport, LogLevel, Ms, Repository, repositoryTokenFor, SmtpEmailTransport, ZIBRI_DI_TOKENS, ZIBRI_INVOICING_PLUGIN_DI_TOKENS, ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from 'zibri';

import { optionalEnv, requireEnv } from './env';
import { Company } from './models';
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
        token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
        useFactory: (): EmailConfigInput => {
            return {
                maxEmailsPerHour: 0,
                defaultSender: optionalEnv('EMAIL_DEFAULT_SENDER')
            };
        }
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT,
        useFactory: () => new SmtpEmailTransport({
            host: optionalEnv('SMTP_HOST'),
            port: Number(optionalEnv('SMTP_PORT')),
            auth: {
                user: optionalEnv('SMTP_USER'),
                pass: optionalEnv('SMTP_PASSWORD')
            }
        })
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.CONFIRM_PASSWORD_RESET_URL,
        useFactory: () => requireEnv('CONFIRM_PASSWORD_RESET_URL')
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
            // each tenant is a company, so an invoice is issued by the company it was written in
            resolveCompanyInfo: async (tenantId: string): Promise<CompanyInfo> => {
                const company: Company = await inject<Repository<Company>>(repositoryTokenFor(Company)).findById(tenantId);
                return {
                    address: {
                        street: '',
                        number: '',
                        postcode: '',
                        city: '',
                        countryId: ''
                    },
                    name: company.name,
                    fullName: company.name,
                    email: '',
                    phone: ''
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