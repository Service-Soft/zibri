import { InternalError } from '../../../error-handling/internal-error.model';
import { InvoiceNumberToken } from '../models/invoice-number-token.type';
import { type InvoicingOptions } from '../models/invoicing-options.model';

/**
 * The tokens an invoice number format can name.
 */
const INVOICE_TOKENS: readonly InvoiceNumberToken[] = ['year', 'yy', 'month', 'recipient', 'counter'];

/**
 * The tokens a credit note number format can name. No `{recipient}`: a credit note knows the invoice it
 * corrects, and not who it was numbered for.
 */
const CREDIT_NOTE_TOKENS: readonly InvoiceNumberToken[] = ['invoice', 'year', 'yy', 'month', 'counter'];

/**
 * A name in braces.
 */
const TOKEN_PATTERN: RegExp = /\{([^{}]*)\}/g;

/**
 * Reads and renders the formats invoice and credit note numbers are drawn in, such as
 * `{year}-{recipient}-{counter}`.
 */
export abstract class InvoiceNumberFormatUtilities {
    /**
     * Gets the format of invoice numbers the invoicing options name, or the default, the year, the name
     * abbreviation and the counter with the `separator` between them.
     * @param options - The invoicing options.
     * @returns The format.
     */
    static getInvoiceFormat(options: InvoicingOptions): string {
        // the default for options written out whole for 3.2, which have none
        return options.numberFormat ?? `{year}${options.separator}{recipient}${options.separator}{counter}`;
    }

    /**
     * Gets the format of credit note numbers the invoicing options name, or the default, `{invoice}-C{counter}`.
     * @param options - The invoicing options.
     * @returns The format.
     */
    static getCreditNoteFormat(options: InvoicingOptions): string {
        return options.creditNoteNumberFormat ?? '{invoice}-C{counter}';
    }

    /**
     * Validates a format of invoice numbers.
     * @param format - The format.
     * @param source - Where the format is set, such as `numberFormat of the invoicing options`, for the message.
     * @throws An InternalError naming the format, when it names a token other than `{year}`, `{yy}`, `{month}`,
     * `{recipient}` and `{counter}`, or not `{counter}` once.
     */
    static validateInvoiceFormat(format: string, source: string): void {
        this.validate(format, source, INVOICE_TOKENS);
    }

    /**
     * Validates a format of credit note numbers.
     * @param format - The format.
     * @param source - Where the format is set, such as `creditNoteNumberFormat of the invoicing options`, for the
     * message.
     * @throws An InternalError naming the format, when it names a token other than `{invoice}`, `{year}`, `{yy}`,
     * `{month}` and `{counter}`, or not `{counter}` once.
     */
    static validateCreditNoteFormat(format: string, source: string): void {
        this.validate(format, source, CREDIT_NOTE_TOKENS);
    }

    /**
     * Whether a format names a token.
     * @param format - The format.
     * @param token - The token.
     * @returns True when it does.
     */
    static hasToken(format: string, token: InvoiceNumberToken): boolean {
        return format.includes(`{${token}}`);
    }

    /**
     * Renders a format, every token but `{counter}`.
     * @param format - The format, validated.
     * @param values - The value of each token it names.
     * @returns What comes before the counter, and what after it.
     * @throws An InternalError when the format names a token without a value.
     */
    static resolveParts(format: string, values: Partial<Record<InvoiceNumberToken, string>>): [string, string] {
        // split before rendering, so that a value holding the text `{counter}`, such as an abbreviation
        // given by hand, is not taken for the counter
        const [before = '', after = ''] = format.split('{counter}');
        return [this.render(before, values), this.render(after, values)];
    }

    private static render(text: string, values: Partial<Record<InvoiceNumberToken, string>>): string {
        return text.replaceAll(TOKEN_PATTERN, (_match: string, token: string) => {
            const value: string | undefined = Object.entries(values).find(([name]) => name === token)?.[1];
            if (value == undefined) {
                throw new InternalError(`The invoice number format names {${token}}, which has no value here.`);
            }
            return value;
        });
    }

    private static validate(format: string, source: string, tokens: readonly InvoiceNumberToken[]): void {
        const named: string[] = [...format.matchAll(TOKEN_PATTERN)].map(match => match[1] ?? '');
        const unknown: string | undefined = named.find(token => !tokens.some(t => t === token));
        if (unknown != undefined) {
            const allowed: string = tokens.map(t => `{${t}}`).join(', ');
            throw new InternalError(`The ${source}, "${format}", names the unknown token {${unknown}}. It can name ${allowed}.`);
        }
        if (named.filter(token => token === 'counter').length !== 1) {
            throw new InternalError(`The ${source}, "${format}", needs to name {counter} once.`);
        }
    }
}