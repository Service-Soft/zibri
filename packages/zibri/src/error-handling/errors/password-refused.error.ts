import { BadRequestError } from './bad-request.error';
import { TranslatedString } from '../../localization/models/translated-string.model';

/**
 * An error to throw when a password written is shorter or longer than the password policy says.
 */
export class PasswordRefusedError extends BadRequestError {
    constructor(message: TranslatedString, options?: ErrorOptions) {
        super(message, options);
        this.name = 'PasswordRefusedError';
    }
}