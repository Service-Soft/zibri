/* eslint-disable typescript/typedef */
import { type FileSize } from '../../../entity/models/file-property-metadata.model';

/**
 * The shapes of the values the bank plugin stores, and what it takes at most.
 */
export abstract class BankLimits {
    /**
     * An IBAN in capitals and without spaces: a country, two check digits and the account.
     */
    static readonly IBAN_REGEX: RegExp = /^[A-Z]{2}\d{2}[\dA-Z]{11,30}$/;
    /**
     * A currency, such as `EUR`.
     */
    static readonly CURRENCY_REGEX: RegExp = /^[A-Z]{3}$/;
    /**
     * The longest name of an account.
     */
    static readonly NAME_MAX_LENGTH = 200;
    /**
     * The largest CAMT.053 file, which holds a year of bookings of a busy account.
     */
    static readonly FILE_MAX_SIZE: FileSize = '50mb';
}