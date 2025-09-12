import { DiProvider, EmailConfigInput, InvoicingOptionsInput, ZIBRI_DI_TOKENS, ZIBRI_INVOICING_DI_TOKENS } from 'zibri';

export const providers: DiProvider<unknown>[] = [
    {
        token: ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_SECRET,
        useFactory: () => 'test'
    },
    {
        token: ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_SECRET,
        useFactory: () => 'test'
    },
    {
        token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
        useFactory: (): EmailConfigInput => {
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
    },
    {
        token: ZIBRI_DI_TOKENS.JWT_CONFIRM_PASSWORD_RESET_URL,
        useFactory: () => 'http://localhost:4200/confirm-password-reset'
    },
    {
        token: ZIBRI_INVOICING_DI_TOKENS.OPTIONS_INPUT,
        useFactory: (): InvoicingOptionsInput => {
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
    }
];