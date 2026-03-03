import { defineProvider, DiProvider, LoggerTransport, LogLevel, ZIBRI_DI_TOKENS, ZIBRI_INVOICING_DI_TOKENS } from 'zibri';

import { ErrorPage } from './templates/pages/error';

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
        token: ZIBRI_DI_TOKENS.JWT_CONFIRM_PASSWORD_RESET_URL,
        useFactory: () => 'http://localhost:4200/confirm-password-reset'
    }),
    defineProvider({
        token: ZIBRI_INVOICING_DI_TOKENS.OPTIONS_INPUT,
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
    })
];