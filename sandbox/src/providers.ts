import { AesGcmEncryptionStrategy, defineDateFormat, defineProvider, DiProvider, LoggerTransport, LogLevel, ZIBRI_DI_TOKENS, ZIBRI_INVOICING_PLUGIN_DI_TOKENS, ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from 'zibri';

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
                value: '42'
            }
        }
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.PASSWORD_RESET_EMAIL_TEMPLATE,
        useFactory: () => PasswordResetEmail
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_SECRET,
        useFactory: () => 'test'
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_SECRET,
        useFactory: () => 'test'
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
        useFactory: () => {
            return {
                maxEmailsPerHour: 0,
                defaultSender: 'Max Mustermann',
                host: '',
                port: 0,
                auth: {
                    user: '',
                    pass: ''
                }
            };
        }
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.CONFIRM_PASSWORD_RESET_URL,
        useFactory: () => 'http://localhost:4200/confirm-password-reset'
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
        token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
        useFactory: () => {
            return {
                companyInfo: {
                    address: {
                        street: '',
                        number: '',
                        postcode: '',
                        city: '',
                        countryId: ''
                    },
                    name: '',
                    fullName: '',
                    email: '',
                    phone: ''
                }
            };
        }
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT,
        useValue: {
            defaultLocale: 'de',
            supportedLocales: {
                'en-US': {
                    currencyCode: 'USD',
                    defaultDateFormat: defineDateFormat('MM/DD/YYYY'),
                    defaultDateTimeFormat: defineDateFormat('MM/DD/YYYY h:mm A'),
                    defaultTimeFormat: defineDateFormat('h:mm A')
                },
                de: {
                    currencyCode: 'EUR',
                    defaultDateFormat: defineDateFormat('DD.MM.YYYY'),
                    defaultDateTimeFormat: defineDateFormat('DD.MM.YYYY HH:mm'),
                    defaultTimeFormat: defineDateFormat('HH:mm')
                }
            }
        }
    })
];