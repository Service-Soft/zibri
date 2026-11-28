import { createHash } from 'node:crypto';

import { XmlElementNode } from '../../../document/xml-element-node.model';
import { XmlReaderUtilities } from '../../../document/xml-reader.utilities';
import { XmlUtilities } from '../../../document/xml.utilities';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { $ts } from '../../../localization/translate.function';
import { BigNumber, NumberUtilities } from '../../../utilities/number.utilities';
import { normalizeIban } from '../normalize-iban.function';
import { CamtAccount } from './camt-account.model';
import { CamtAmount } from './camt-amount.model';
import { CamtBalance } from './camt-balance.model';
import { CamtCreditDebit } from './camt-credit-debit.enum';
import { CamtDate } from './camt-date.model';
import { CamtDocument } from './camt-document.model';
import { CamtEntry } from './camt-entry.model';
import { CamtParty } from './camt-party.model';
import { CamtRelatedParties } from './camt-related-parties.model';
import { CamtStatementData } from './camt-statement-data.model';
import { CamtStatement } from './camt-statement.model';
import { CamtTransactionData } from './camt-transaction-data.model';
import { CamtTransactionDetails } from './camt-transaction-details.model';
import { Camt053Namespace } from './camt053-namespace.enum';

/**
 * One transaction an entry books: the details the file gives of it, and its amount without its sign.
 */
type CamtEntryPart = {
    /**
     * The details, undefined when the entry gives none of this transaction alone.
     */
    details: CamtTransactionDetails | undefined,
    /**
     * The amount, without its sign.
     */
    amount: CamtAmount,
    /**
     * The place of the transaction in its entry, undefined for an entry booking one.
     */
    index: number | undefined
};

/**
 * The codes of the balances a statement opens with: the opening booked balance, or the closing booked balance of
 * the statement before, which some banks give instead.
 */
const OPENING_BALANCE_CODES: Set<string> = new Set(['OPBD', 'PRCD']);

/**
 * The code of the balance a statement closes with.
 */
const CLOSING_BALANCE_CODE: string = 'CLBD';

/**
 * The status of a booked entry. Every other, such as `PDNG` for pending, is left out.
 */
const BOOKED_STATUS: string = 'BOOK';

/**
 * What a payer writes as the end to end id when they gave none.
 */
const NO_END_TO_END_ID: string = 'NOTPROVIDED';

/**
 * Reads the statements of a CAMT.053 file, of the versions `camt.053.001.02` and `camt.053.001.08`.
 */
export abstract class Camt053Utilities {
    /**
     * Resolves the statements of a CAMT.053 file, each with its booked transactions.
     * @param xml - The file.
     * @returns The statements, in the order of the file.
     * @throws A BadRequestError when the file is not a CAMT.053 file of a version it reads, or its booked entries do
     * not add up from the opening to the closing balance of their statement.
     */
    static async resolveStatements(xml: string): Promise<CamtStatementData[]> {
        const format: string = this.resolveFormat(xml);
        let document: CamtDocument;
        try {
            // the root holds the group header besides the statements, which is not read
            document = await XmlUtilities.parseFrom(CamtDocument, xml, { allowAdditionalProperties: true });
        }
        catch (error) {
            throw new BadRequestError($ts`The file needs to be a CAMT.053 statement, and could not be read as one.`, { cause: error });
        }
        return document.bankToCustomerStatement.statements.map(statement => this.resolveStatement(statement, format));
    }

    /**
     * Resolves the version of CAMT.053 a file is written in, from the namespace of its root.
     * @param xml - The file.
     * @returns The version, such as `camt.053.001.02`.
     * @throws A BadRequestError for a file that is not xml, or of another version or format.
     */
    private static resolveFormat(xml: string): string {
        // read once more by parseFrom, which matches elements by their names alone and so cannot tell the versions
        let root: XmlElementNode;
        try {
            root = XmlReaderUtilities.resolveRootElement(xml);
        }
        catch (error) {
            throw new BadRequestError($ts`The file needs to be a well formed xml document.`, { cause: error });
        }
        const namespace: string | undefined = Object.values(Camt053Namespace).find(n => n === root.namespace);
        if (root.name !== 'Document' || namespace == undefined) {
            throw new BadRequestError(
                $ts`The file needs to be a CAMT.053 statement of the version camt.053.001.02 or camt.053.001.08.`
            );
        }
        return namespace.slice(namespace.lastIndexOf(':') + 1);
    }

    private static resolveStatement(statement: CamtStatement, format: string): CamtStatementData {
        const iban: string | undefined = this.findIban(statement.account);
        if (iban == undefined) {
            throw new BadRequestError($ts`The statement "${statement.id}" needs to name the IBAN of its account.`);
        }
        const opening: CamtBalance | undefined = statement.balances
            .find(b => OPENING_BALANCE_CODES.has(b.type.codeOrProprietary.code ?? ''));
        const closing: CamtBalance | undefined = statement.balances
            .find(b => b.type.codeOrProprietary.code === CLOSING_BALANCE_CODE);
        if (opening == undefined || closing == undefined) {
            throw new BadRequestError($ts`The statement "${statement.id}" needs an opening and a closing booked balance.`);
        }
        const openingBalanceDate: Date = this.resolveDate(opening.date, statement);
        const closingBalanceDate: Date = this.resolveDate(closing.date, statement);
        const transactions: CamtTransactionData[] = this.resolveTransactions(statement);

        const openingBalance: BigNumber = this.resolveSigned(opening.amount, opening.creditDebit);
        const closingBalance: BigNumber = this.resolveSigned(closing.amount, closing.creditDebit);
        const booked: BigNumber = transactions.reduce((sum, t) => NumberUtilities.add(sum, t.amount), NumberUtilities.new(0));
        if (NumberUtilities.compare(NumberUtilities.add(openingBalance, booked), closingBalance) !== 0) {
            const from: string = openingBalance.toFixed();
            const to: string = closingBalance.toFixed();
            throw new BadRequestError(
                // eslint-disable-next-line stylistic/max-len
                $ts`The booked entries of the statement "${statement.id}" need to add up from its opening balance ${from} to its closing balance ${to}.`
            );
        }
        return {
            iban,
            format,
            currency: statement.account.currency ?? closing.amount.currency,
            bankStatementId: statement.id,
            electronicSequenceNumber: statement.electronicSequenceNumber ?? null,
            issuedAt: statement.createdAt,
            periodStart: statement.period?.from ?? openingBalanceDate,
            periodEnd: statement.period?.to ?? closingBalanceDate,
            openingBalance,
            openingBalanceDate,
            closingBalance,
            closingBalanceDate,
            transactions
        };
    }

    /**
     * Resolves the booked transactions of a statement, each with the key that tells it apart from every other of its
     * account.
     * @param statement - The statement.
     * @returns The transactions, in the order of the file.
     * @throws A BadRequestError for a booked entry without a booking date.
     */
    private static resolveTransactions(statement: CamtStatement): CamtTransactionData[] {
        const res: CamtTransactionData[] = [];
        // a key seen before in the statement is counted on, so that two bookings holding the same, such as two coffees
        // of the same price on one day, are two transactions, and the same two of another file the same two again
        const seen: Map<string, number> = new Map();
        for (const entry of statement.entries ?? []) {
            if (!this.isBooked(entry)) {
                continue;
            }
            const bookingDate: Date | undefined = entry.bookingDate?.date ?? entry.bookingDate?.dateTime;
            if (bookingDate == undefined) {
                throw new BadRequestError($ts`The booked entries of the statement "${statement.id}" need a booking date.`);
            }
            for (const part of this.resolveParts(entry)) {
                const transaction: CamtTransactionData = this.resolveTransaction(entry, part, bookingDate);
                const occurrence: number = seen.get(transaction.deduplicationKey) ?? 0;
                seen.set(transaction.deduplicationKey, occurrence + 1);
                res.push(occurrence === 0
                    ? transaction
                    : { ...transaction, deduplicationKey: `${transaction.deduplicationKey}#${occurrence}` });
            }
        }
        return res;
    }

    private static isBooked(entry: CamtEntry): boolean {
        return (entry.status.code ?? entry.status.text)?.trim() === BOOKED_STATUS;
    }

    /**
     * Resolves the transactions an entry books: each of a batch whose amounts make up the entry, or the entry as one.
     * @param entry - The entry.
     * @returns The transactions.
     */
    private static resolveParts(entry: CamtEntry): CamtEntryPart[] {
        const details: CamtTransactionDetails[] = (entry.details ?? []).flatMap(d => d.transactions ?? []);
        const amounts: (CamtAmount | undefined)[] = details.map(d => d.amountDetails?.transactionAmount?.amount ?? d.amount);
        const known: CamtAmount[] = amounts.filter(a => a != undefined);
        const total: BigNumber = known.reduce((sum, a) => NumberUtilities.add(sum, a.value), NumberUtilities.new(0));
        // a batch is split into its transactions only when they add up to what the entry booked, which keeps the
        // balance of the statement. Otherwise its details cannot be told apart, and the entry is one transaction
        if (details.length > 1 && known.length === details.length && NumberUtilities.compare(total, entry.amount.value) === 0) {
            return details.map((d, index) => ({ details: d, amount: known[index] ?? entry.amount, index }));
        }
        return [{ details: details.length === 1 ? details[0] : undefined, amount: entry.amount, index: undefined }];
    }

    private static resolveTransaction(entry: CamtEntry, part: CamtEntryPart, bookingDate: Date): CamtTransactionData {
        // the other party is who paid for money received, and who was paid for money paid. A reversal keeps the
        // parties of the booking it reverses, whose direction was the other one
        const received: boolean = (entry.creditDebit === CamtCreditDebit.CREDIT) !== (entry.reversal === true);
        const parties: CamtRelatedParties | undefined = part.details?.relatedParties;
        const counterparty: CamtParty | undefined = received ? parties?.debtor : parties?.creditor;
        const counterpartyAccount: CamtAccount | undefined = received ? parties?.debtorAccount : parties?.creditorAccount;
        const endToEndId: string | undefined = part.details?.references?.endToEndId;
        const lines: string[] = part.details?.remittanceInformation?.unstructured ?? [];
        const data: Omit<CamtTransactionData, 'deduplicationKey'> = {
            bookingDate,
            valueDate: entry.valueDate?.date ?? entry.valueDate?.dateTime ?? null,
            amount: this.resolveSigned(part.amount, entry.creditDebit),
            currency: part.amount.currency,
            counterpartyName: (counterparty?.party ?? counterparty)?.name ?? null,
            counterpartyIban: counterpartyAccount == undefined ? null : this.findIban(counterpartyAccount) ?? null,
            remittanceInformation: lines.length ? lines.join(' ') : null,
            endToEndId: endToEndId == undefined || endToEndId === NO_END_TO_END_ID ? null : endToEndId,
            mandateId: part.details?.references?.mandateId ?? null,
            creditorId: this.findCreditorId(parties?.creditor),
            bankReference: entry.bankReference ?? null
        };
        return { ...data, deduplicationKey: this.resolveDeduplicationKey(data, part.index) };
    }

    /**
     * Resolves what tells a transaction apart from every other of its account: the reference the bank gave its
     * entry, or a hash of what it holds when the bank gave none.
     * @param data - The transaction.
     * @param index - Its place in its entry, for an entry booking several.
     * @returns The key.
     */
    private static resolveDeduplicationKey(data: Omit<CamtTransactionData, 'deduplicationKey'>, index: number | undefined): string {
        const suffix: string = index == undefined ? '' : `/${index}`;
        if (data.bankReference != undefined) {
            return `ref:${data.bankReference}${suffix}`;
        }
        // of the values as they were read, not of the xml, so that a file of the other version, or laid out another
        // way, holding the same booking hashes to the same key
        const values: unknown[] = [
            data.bookingDate.toISOString(),
            data.valueDate?.toISOString() ?? null,
            data.amount.toFixed(),
            data.currency,
            data.counterpartyName,
            data.counterpartyIban,
            data.remittanceInformation,
            data.endToEndId,
            data.mandateId,
            data.creditorId
        ];
        const hash: string = createHash('sha256')
            .update(JSON.stringify(values))
            .digest('hex');
        return `hash:${hash}${suffix}`;
    }

    private static findCreditorId(creditor: CamtParty | undefined): string | null {
        return (creditor?.party ?? creditor)?.id?.person?.others?.find(o => o.schemeName?.proprietary === 'SEPA')?.id ?? null;
    }

    private static findIban(account: CamtAccount): string | undefined {
        return account.id.iban == undefined ? undefined : normalizeIban(account.id.iban);
    }

    private static resolveSigned(amount: CamtAmount, creditDebit: CamtCreditDebit): BigNumber {
        return creditDebit === CamtCreditDebit.DEBIT ? NumberUtilities.subtract(0, amount.value) : amount.value;
    }

    private static resolveDate(date: CamtDate, statement: CamtStatement): Date {
        const res: Date | undefined = date.date ?? date.dateTime;
        if (res == undefined) {
            throw new BadRequestError($ts`The balances of the statement "${statement.id}" need a date.`);
        }
        return res;
    }
}