import { LocaleCode } from './locale-code.type';

/**
 * What `PATCH /me` takes. A value left out stays as it is.
 */
export type UpdateCurrentUserInput = {
    /**
     * The locale the mails of the framework reach the user in, one the application supports, such as `de`, or null
     * for the default locale.
     */
    locale?: LocaleCode | null
};