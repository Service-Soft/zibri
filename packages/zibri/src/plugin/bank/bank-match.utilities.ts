import { NumberUtilities } from '../../utilities/number.utilities';
import { type InvoiceAddress } from '../invoicing/models/invoice-address.model';
import { type BankMatchCandidate } from './models/bank-match-candidate.model';
import { BankMatchReason } from './models/bank-match-reason.enum';
import { type BankMatchScore } from './models/bank-match-score.model';

/**
 * What each reason adds to the confidence, in hundredths. The counterparty adds once, by its name or its IBAN.
 */
const WEIGHTS: Record<Exclude<BankMatchReason, BankMatchReason.ACCOUNT_RULE>, number> = {
    [BankMatchReason.INVOICE_NUMBER]: 60,
    [BankMatchReason.DOCUMENT_NUMBER]: 60,
    [BankMatchReason.AMOUNT]: 25,
    [BankMatchReason.COUNTERPARTY_NAME]: 15,
    [BankMatchReason.COUNTERPARTY_IBAN]: 15
};

/**
 * The confidence below which a candidate is not suggested, in hundredths: the invoice number alone is enough, and so
 * is the amount with the counterparty, but neither the amount nor the counterparty alone.
 */
const MIN_CONFIDENCE: number = 40;

/**
 * The legal forms a company name carries, which two different companies share and which tell nothing about which one
 * paid.
 */
// cspell:disable-next-line
const LEGAL_FORMS: ReadonlySet<string> = new Set('AG BV CO EG EK EV GBR GMBH INC KG KGAA LLC LTD MBH NV OHG PLC SA SARL SE UG'.split(' '));

/**
 * Scores how sure the bank plugin is that a transaction pays an invoice: by the invoice number in what the payer
 * wrote, the amount, and the counterparty.
 */
export abstract class BankMatchUtilities {
    /**
     * Resolves how sure the matching is that a transaction pays an invoice.
     * @param candidate - The transaction and the invoice, with what of each is open.
     * @returns The confidence and its reasons, or undefined below the confidence a suggestion needs.
     */
    static resolveScore(candidate: BankMatchCandidate): BankMatchScore | undefined {
        const { transaction, invoice } = candidate;
        const reasons: Exclude<BankMatchReason, BankMatchReason.ACCOUNT_RULE>[] = [];
        const text: string = [transaction.remittanceInformation, transaction.endToEndId].filter(t => t != undefined).join(' ');
        if (this.containsInvoiceNumber(text, invoice.number)) {
            reasons.push(BankMatchReason.INVOICE_NUMBER);
        }
        if (NumberUtilities.compare(candidate.transactionOpen, candidate.invoiceOpen) === 0) {
            reasons.push(BankMatchReason.AMOUNT);
        }
        if (this.isRecipient(transaction.counterpartyName, invoice.customerAddressData)) {
            reasons.push(BankMatchReason.COUNTERPARTY_NAME);
        }
        if (candidate.recipientsPaidByIban.has(this.resolveRecipientKey(invoice.customerAddressData))) {
            reasons.push(BankMatchReason.COUNTERPARTY_IBAN);
        }
        return this.resolveScoreOf(reasons);
    }

    /**
     * Resolves how sure the matching is from the reasons found: the number, the amount and, once, the counterparty.
     * @param reasons - The reasons, without `ACCOUNT_RULE`, which an account match rule scores itself.
     * @returns The confidence and its reasons, or undefined below the confidence a suggestion needs.
     */
    static resolveScoreOf(reasons: Exclude<BankMatchReason, BankMatchReason.ACCOUNT_RULE>[]): BankMatchScore | undefined {
        const counterparty: number = Math.max(
            reasons.includes(BankMatchReason.COUNTERPARTY_NAME) ? WEIGHTS[BankMatchReason.COUNTERPARTY_NAME] : 0,
            reasons.includes(BankMatchReason.COUNTERPARTY_IBAN) ? WEIGHTS[BankMatchReason.COUNTERPARTY_IBAN] : 0
        );
        const hundredths: number = counterparty + reasons
            .filter(r => r !== BankMatchReason.COUNTERPARTY_NAME && r !== BankMatchReason.COUNTERPARTY_IBAN)
            .reduce((sum, r) => sum + WEIGHTS[r], 0);
        return hundredths < MIN_CONFIDENCE ? undefined : { confidence: hundredths / 100, reasons };
    }

    /**
     * Whether a text names an invoice number, with or without the separators of the number, as a word of its own.
     * @param text - The text, such as the remittance information `Invoice 2026-ACME-0001, thank you`.
     * @param invoiceNumber - The number, such as `2026-ACME-0001`.
     * @returns Whether the text names it. `2026 ACME 0001` and `2026ACME0001` name it, `2026-ACME-00012` does not.
     */
    static containsInvoiceNumber(text: string, invoiceNumber: string): boolean {
        const parts: string[] = this.resolveWords(invoiceNumber);
        if (!parts.length) {
            return false;
        }
        const words: string = ` ${this.resolveWords(text).join(' ')} `;
        return words.includes(` ${parts.join(' ')} `) || words.includes(` ${parts.join('')} `);
    }

    /**
     * Whether a counterparty is the recipient of an invoice, by name: every word of the name of the company, without
     * its legal form, or of the last name of a private recipient, is a word of the name of the counterparty.
     * @param counterpartyName - The name of the counterparty, such as `ACME LTD LONDON`.
     * @param address - The address of the recipient.
     * @returns Whether the names match.
     */
    static isRecipient(counterpartyName: string | null | undefined, address: InvoiceAddress): boolean {
        return this.isNamed(counterpartyName, address.company ? address.companyName ?? '' : address.lastName);
    }

    /**
     * Whether a counterparty has a name: every word of it, without a legal form, is a word of the name of the
     * counterparty.
     * @param counterpartyName - The name of the counterparty, such as `OFFICE SUPPLIES LTD BERLIN`.
     * @param name - The name, such as `Office Supplies GmbH`.
     * @returns Whether the names match.
     */
    static isNamed(counterpartyName: string | null | undefined, name: string): boolean {
        if (counterpartyName == undefined) {
            return false;
        }
        const words: string[] = this.resolveWords(name).filter(word => word.length > 1 && !LEGAL_FORMS.has(word));
        const counterparty: Set<string> = new Set(this.resolveWords(counterpartyName));
        return words.length > 0 && words.every(word => counterparty.has(word));
    }

    /**
     * Resolves what tells the recipients of invoices apart: the name of a company, or the first and last name of a
     * private recipient, in capitals.
     * @param address - The address of the recipient.
     * @returns The key.
     */
    static resolveRecipientKey(address: InvoiceAddress): string {
        const name: string = address.company ? address.companyName ?? '' : `${address.firstName} ${address.lastName}`;
        return `${address.company ? 'company' : 'person'}:${this.resolveWords(name).join(' ')}`;
    }

    /**
     * Splits a text into its words, in capitals and without accents, such as `MULLER` of `Müller`.
     * @param text - The text.
     * @returns The words: what is between anything that is no letter or digit.
     */
    private static resolveWords(text: string): string[] {
        return text.normalize('NFKD').replaceAll(/\p{M}/gu, '')
            .toUpperCase()
            .split(/[^\p{L}\p{N}]+/u)
            .filter(word => word !== '');
    }
}