import { Repository } from '../../../data-source/repository/repository';
import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { ConflictError } from '../../../error-handling/errors/conflict.error';
import { $ts } from '../../../localization/translate.function';
import { BigNumber, NumberUtilities } from '../../../utilities/number.utilities';
import { BankMatchTargetType } from '../../bank/models/bank-match-target-type.enum';
import { type BankMatch } from '../../bank/models/bank-match.model';
import { type BankTransaction } from '../../bank/models/bank-transaction.model';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../../invoicing/invoicing.tokens';
import { InvoiceType } from '../../invoicing/models/invoice-type.enum';
import { Invoice } from '../../invoicing/models/invoice.model';
import { type Vat } from '../../invoicing/models/vat.model';
import { type InvoiceCalcServiceInterface } from '../../invoicing/services/invoice-calc-service.interface';
import { BookkeepingDayUtilities } from '../bookkeeping-day.utilities';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../bookkeeping.tokens';
import { JournalEntryUtilities } from '../journal-entry.utilities';
import { BookkeepingAccount } from '../models/bookkeeping-account.model';
import { type BookkeepingReportContext } from '../models/bookkeeping-report-context.model';
import { type BookkeepingSettings } from '../models/bookkeeping-settings.model';
import { Expense } from '../models/expense.model';
import { FiscalYear } from '../models/fiscal-year.model';
import { JournalEntryLine } from '../models/journal-entry-line.model';
import { JournalEntry } from '../models/journal-entry.model';
import { type NewJournalEntryLine } from '../models/new-journal-entry-line.model';
import { type NewJournalEntry } from '../models/new-journal-entry.model';
import { type NewPostingRuleSet } from '../models/new-posting-rule-set.model';
import { PostingRuleSet, type PostingRuleSetCreateData } from '../models/posting-rule-set.model';
import { type PostingRuleTaxAccount } from '../models/posting-rule-tax-account.model';
import { type PostingRules } from '../models/posting-rules.model';
import { PostingSourceType } from '../models/posting-source-type.enum';
import { type PostingSource } from '../models/posting-source.model';
import { BookkeepingConformanceUtilities } from './conformance/bookkeeping-conformance.utilities';
import { type PostingRuleServiceInterface } from './posting-rule-service.interface';

/**
 * The rules valid on a day, as a source of that day is posted by them.
 */
type RulesOfDay = {
    /**
     * The rules.
     */
    rules: PostingRules,
    /**
     * The day, such as `2026-03-31`, which the messages name.
     */
    day: string
};

/**
 * What an invoice states for one tax group, the way the invoice calc service calculates it.
 */
type InvoiceTaxGroup = {
    /**
     * The VAT of the group.
     */
    vat: Vat,
    /**
     * The total before tax.
     */
    net: BigNumber,
    /**
     * The tax.
     */
    tax: BigNumber
};

/**
 * Which side of an account a line is on.
 */
type Side = 'debit' | 'credit';

/**
 * Default implementation of the posting rule service.
 */
@Injectable({ register: 'onUse' })
export class PostingRuleService implements PostingRuleServiceInterface {
    // read when used, like the repositories of the journal service: ZibriBookkeepingPlugin.validate names a missing
    // entity rather than a failed build of this
    private get ruleSetRepository(): Repository<PostingRuleSet, PostingRuleSetCreateData> {
        return inject(repositoryTokenFor(PostingRuleSet));
    }

    private get fiscalYearRepository(): Repository<FiscalYear> {
        return inject(repositoryTokenFor(FiscalYear));
    }

    private get accountRepository(): Repository<BookkeepingAccount> {
        return inject(repositoryTokenFor(BookkeepingAccount));
    }

    private get entryRepository(): Repository<JournalEntry> {
        return inject(repositoryTokenFor(JournalEntry));
    }

    private get lineRepository(): Repository<JournalEntryLine> {
        return inject(repositoryTokenFor(JournalEntryLine));
    }

    // of the invoicing plugin, read only for the invoices it posts
    private get invoiceRepository(): Repository<Invoice> {
        return inject(repositoryTokenFor(Invoice));
    }

    private get expenseRepository(): Repository<Expense> {
        return inject(repositoryTokenFor(Expense));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveEntry(
        source: PostingSource,
        settings: BookkeepingSettings,
        transaction: Transaction
    ): Promise<NewJournalEntry | undefined> {
        switch (source.type) {
            case PostingSourceType.INVOICE: {
                return await this.resolveInvoiceEntry(source.invoice, settings, transaction);
            }
            case PostingSourceType.CREDIT_NOTE: {
                return await this.resolveCreditNoteEntry(source.invoice, settings, transaction);
            }
            case PostingSourceType.EXPENSE: {
                return await this.resolveExpenseEntry(source.expense, settings, transaction);
            }
            case PostingSourceType.BANK_MATCH: {
                return await this.resolveBankMatchEntry(source.match, source.bankTransaction, settings, transaction);
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findRuleSets(fiscalYearId: string | undefined): Promise<PostingRuleSet[]> {
        return await this.ruleSetRepository.findAll({
            where: fiscalYearId == undefined ? undefined : { fiscalYearId },
            order: { validFrom: 'ASC' },
            limit: 'all'
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createRuleSet(ruleSet: NewPostingRuleSet, transaction?: Transaction): Promise<PostingRuleSet> {
        return await this.runInTransaction(transaction, async started => {
            const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(ruleSet.fiscalYearId, { transaction: started });
            const validFrom: Date = ruleSet.validFrom ?? fiscalYear.start;
            BookkeepingDayUtilities.validateDay(validFrom, 'validFrom');
            const [start, end, day] = [fiscalYear.start, fiscalYear.end, validFrom].map(d => BookkeepingDayUtilities.formatDay(d));
            if (validFrom.getTime() < fiscalYear.start.getTime() || validFrom.getTime() > fiscalYear.end.getTime()) {
                throw new ConflictError($ts`The posting rules need to be valid from a day of the fiscal year from ${start} to ${end}.`);
            }
            await this.validateRules(ruleSet.rules, started);
            await this.validateConformingRules(fiscalYear, [ruleSet.rules], undefined, started);
            if (await this.ruleSetRepository.exists({ where: { fiscalYearId: fiscalYear.id, validFrom }, transaction: started })) {
                throw new ConflictError(
                    // eslint-disable-next-line stylistic/max-len -- one template, since it is the key of its translation
                    $ts`The fiscal year from ${start} to ${end} has posting rules valid from ${day} already, which are changed rather than added again.`
                );
            }
            return await this.ruleSetRepository.create(
                { fiscalYearId: fiscalYear.id, validFrom, rules: ruleSet.rules },
                { transaction: started }
            );
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateRuleSet(id: string, rules: PostingRules, transaction?: Transaction): Promise<PostingRuleSet> {
        return await this.runInTransaction(transaction, async started => {
            const ruleSet: PostingRuleSet = await this.ruleSetRepository.findById(id, { transaction: started });
            await this.validateRules(rules, started);
            const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(ruleSet.fiscalYearId, { transaction: started });
            await this.validateConformingRules(fiscalYear, [rules], undefined, started);
            return await this.ruleSetRepository.updateById(id, { rules }, { transaction: started });
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validateRuleSets(fiscalYear: FiscalYear, settings: BookkeepingSettings, transaction: Transaction): Promise<void> {
        const ruleSets: PostingRuleSet[] = await this.ruleSetRepository.findAll({
            where: { fiscalYearId: fiscalYear.id },
            limit: 'all',
            transaction
        });
        await this.validateConformingRules(fiscalYear, ruleSets.map(r => r.rules), settings, transaction);
    }

    /**
     * Validates rules by the conformances of their fiscal year, such as that the rules of a UG name the accounts of its
     * legal reserve.
     * @param fiscalYear - The fiscal year of the rules.
     * @param rules - The rules.
     * @param settings - The settings of the books to judge by, those stored when undefined.
     * @param transaction - The transaction.
     * @throws What a conformance throws.
     */
    protected async validateConformingRules(
        fiscalYear: FiscalYear,
        rules: PostingRules[],
        settings: BookkeepingSettings | undefined,
        transaction: Transaction
    ): Promise<void> {
        const judged: BookkeepingSettings | undefined = settings
            ?? await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE).findSettings(transaction);
        if (judged == undefined) {
            return;
        }
        const context: BookkeepingReportContext = {
            settings: judged,
            fiscalYear,
            legalForm: BookkeepingConformanceUtilities.findLegalForm(judged, fiscalYear.end)
        };
        // one after the other, as the reads of one transaction run over one connection
        for (const conformance of BookkeepingConformanceUtilities.resolveConformances(
            inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.BOOKKEEPING_CONFORMANCE_SERVICES),
            judged,
            fiscalYear
        )) {
            for (const rule of rules) {
                await conformance.validatePostingRules?.(rule, context);
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async copyRuleSet(from: FiscalYear, to: FiscalYear, transaction: Transaction): Promise<PostingRuleSet | undefined> {
        const [latest] = await this.ruleSetRepository.findAll({
            where: { fiscalYearId: from.id },
            order: { validFrom: 'DESC' },
            limit: 1,
            transaction
        });
        return latest == undefined
            ? undefined
            : await this.ruleSetRepository.create({ fiscalYearId: to.id, validFrom: to.start, rules: latest.rules }, { transaction });
    }

    /**
     * Resolves the entry of an invoice: its total on the receivables, against the revenue of each VAT category and
     * rate and the output tax of each rate, on the day of the invoice.
     * @param invoice - The invoice.
     * @param settings - The settings of the books.
     * @param transaction - The transaction.
     * @returns The entry, or undefined for an invoice of 0.
     */
    protected async resolveInvoiceEntry(
        invoice: Invoice,
        settings: BookkeepingSettings,
        transaction: Transaction
    ): Promise<NewJournalEntry | undefined> {
        const documentDate: Date = this.resolveDayOf(invoice.date);
        this.validateCurrency(invoice.currency, settings, $ts`The invoice ${invoice.number}`);
        const rules: RulesOfDay = await this.resolveRules(documentDate, transaction);
        const lines: NewJournalEntryLine[] = await this.resolveInvoiceLines(invoice, rules);
        return this.resolveEntryOf(documentDate, invoice.number, $ts`Invoice ${invoice.number}`, lines);
    }

    /**
     * Resolves the entry of a credit note: for one crediting all of its invoice, the mirror of the entry of the invoice,
     * so that it is undone exactly, and else the mirror of what its own amounts would post as an invoice.
     * @param creditNote - The credit note.
     * @param settings - The settings of the books.
     * @param transaction - The transaction.
     * @returns The entry, or undefined for a credit note of 0.
     */
    protected async resolveCreditNoteEntry(
        creditNote: Invoice,
        settings: BookkeepingSettings,
        transaction: Transaction
    ): Promise<NewJournalEntry | undefined> {
        const documentDate: Date = this.resolveDayOf(creditNote.date);
        this.validateCurrency(creditNote.currency, settings, $ts`The credit note ${creditNote.number}`);
        const text: string = $ts`Credit note ${creditNote.number}`;
        const invoiceEntryLines: JournalEntryLine[] | undefined = await this.findFullyCreditedLines(creditNote, transaction);
        if (invoiceEntryLines != undefined) {
            return this.resolveEntryOf(documentDate, creditNote.number, text, JournalEntryUtilities.resolveMirrorLines(invoiceEntryLines));
        }
        const rules: RulesOfDay = await this.resolveRules(documentDate, transaction);
        const lines: NewJournalEntryLine[] = await this.resolveInvoiceLines(creditNote, rules);
        return this.resolveEntryOf(documentDate, creditNote.number, text, JournalEntryUtilities.resolveMirrorLines(lines));
    }

    /**
     * Resolves the entry of an expense: its amounts before tax on its account and its tax on the input tax of each
     * rate, against its total on the payables, on the day of its document.
     * @param expense - The expense.
     * @param settings - The settings of the books.
     * @param transaction - The transaction.
     * @returns The entry, or undefined for an expense of 0.
     */
    protected async resolveExpenseEntry(
        expense: Expense,
        settings: BookkeepingSettings,
        transaction: Transaction
    ): Promise<NewJournalEntry | undefined> {
        this.validateCurrency(expense.currency, settings, $ts`The expense ${expense.documentNumber}`);
        const rules: RulesOfDay = await this.resolveRules(expense.documentDate, transaction);
        const payables: string = this.resolvePayablesAccount(rules);
        const net: BigNumber = expense.totals.reduce((sum, t) => NumberUtilities.add(sum, t.net), NumberUtilities.new(0));
        const total: BigNumber = expense.totals.reduce(
            (sum, t) => NumberUtilities.add(NumberUtilities.add(sum, t.net), t.tax),
            NumberUtilities.new(0)
        );
        const lines: NewJournalEntryLine[] = [
            ...this.resolveLine(expense.accountId, 'debit', net),
            ...expense.totals.flatMap(t => t.tax.isGreaterThan(0)
                ? this.resolveLine(this.resolveTaxAccount(rules, rules.rules.inputTaxAccounts, t.rate, 'input'), 'debit', t.tax)
                : []),
            ...this.resolveLine(payables, 'credit', total)
        ];
        return this.resolveEntryOf(
            expense.documentDate,
            expense.documentNumber,
            $ts`Expense ${expense.documentNumber} of ${expense.supplier.name}`,
            lines
        );
    }

    /**
     * Resolves the entry of a bank match, on the day the transaction was booked: an invoice paid moves its amount from
     * the receivables to the bank, with a difference within the tolerance on the payment difference accounts and the
     * output tax, an expense paid moves it from the bank to the payables, and an account takes it from or gives it to
     * the bank.
     * @param match - The match.
     * @param bankTransaction - The transaction it matches.
     * @param settings - The settings of the books.
     * @param transaction - The transaction.
     * @returns The entry.
     */
    protected async resolveBankMatchEntry(
        match: BankMatch,
        bankTransaction: BankTransaction,
        settings: BookkeepingSettings,
        transaction: Transaction
    ): Promise<NewJournalEntry | undefined> {
        const postingDate: Date = this.resolveDayOf(bankTransaction.bookingDate);
        this.validateCurrency(match.currency, settings, $ts`The bank transaction "${bankTransaction.id}"`);
        const rules: RulesOfDay = await this.resolveRules(postingDate, transaction);
        const bank: string = this.resolveBankAccount(rules, bankTransaction.accountId);
        switch (match.targetType) {
            case BankMatchTargetType.INVOICE: {
                const invoice: Invoice = await this.invoiceRepository.findById(match.targetId, { transaction });
                const difference: BigNumber = match.difference ?? NumberUtilities.new(0);
                const lines: NewJournalEntryLine[] = [
                    ...this.resolveLine(bank, 'debit', match.amount),
                    ...await this.resolveDifferenceLines(invoice, difference, rules, settings),
                    ...this.resolveLine(this.resolveReceivablesAccount(rules), 'credit', NumberUtilities.add(match.amount, difference))
                ];
                return this.resolveEntryOf(postingDate, invoice.number, $ts`Payment of the invoice ${invoice.number}`, lines);
            }
            case BankMatchTargetType.EXPENSE: {
                const expense: Expense = await this.expenseRepository.findById(match.targetId, { transaction });
                const lines: NewJournalEntryLine[] = [
                    ...this.resolveLine(this.resolvePayablesAccount(rules), 'debit', match.amount),
                    ...this.resolveLine(bank, 'credit', match.amount)
                ];
                return this.resolveEntryOf(
                    postingDate,
                    expense.documentNumber,
                    $ts`Payment of the expense ${expense.documentNumber} of ${expense.supplier.name}`,
                    lines
                );
            }
            case BankMatchTargetType.ACCOUNT: {
                const received: boolean = bankTransaction.amount.isGreaterThan(0);
                const lines: NewJournalEntryLine[] = [
                    ...this.resolveLine(received ? bank : match.targetId, 'debit', match.amount),
                    ...this.resolveLine(received ? match.targetId : bank, 'credit', match.amount)
                ];
                const counterparty: string = bankTransaction.counterpartyName ?? bankTransaction.counterpartyIban ?? '-';
                return this.resolveEntryOf(postingDate, null, $ts`Bank transaction of ${counterparty}`, lines);
            }
        }
    }

    /**
     * Resolves the lines of an invoice: its total on the receivables, against the revenue of each VAT category and
     * rate and the output tax of each rate, as the invoice calc service calculates them.
     * @param invoice - The invoice.
     * @param rules - The rules of its day.
     * @returns The lines.
     */
    protected async resolveInvoiceLines(invoice: Invoice, rules: RulesOfDay): Promise<NewJournalEntryLine[]> {
        const groups: InvoiceTaxGroup[] = await this.resolveTaxGroups(invoice);
        const total: BigNumber = groups.reduce(
            (sum, g) => NumberUtilities.add(NumberUtilities.add(sum, g.net), g.tax),
            NumberUtilities.new(0)
        );
        return this.mergeLines([
            ...this.resolveLine(this.resolveReceivablesAccount(rules), 'debit', total),
            ...groups.flatMap(g => this.resolveLine(this.resolveRevenueAccount(rules, g.vat), 'credit', g.net)),
            ...groups.flatMap(g => g.tax.isGreaterThan(0)
                ? this.resolveLine(this.resolveTaxAccount(rules, rules.rules.outputTaxAccounts, g.vat.rate, 'output'), 'credit', g.tax)
                : [])
        ]);
    }

    /**
     * Resolves the lines of a payment difference of an invoice, split by its tax groups in proportion to what each
     * holds after tax: the part of each before tax on the payment difference account of its rate, and its tax off the
     * output tax, which corrects the VAT of the invoice.
     * @param invoice - The invoice.
     * @param difference - The difference, at least 0.
     * @param rules - The rules of the day of the payment.
     * @param settings - The settings of the books, whose currency the parts are rounded to.
     * @returns The lines, none for no difference.
     */
    protected async resolveDifferenceLines(
        invoice: Invoice,
        difference: BigNumber,
        rules: RulesOfDay,
        settings: BookkeepingSettings
    ): Promise<NewJournalEntryLine[]> {
        if (!difference.isGreaterThan(0)) {
            return [];
        }
        const minorUnits: number = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).getCurrencyMinorUnits(settings.currency);
        const groups: InvoiceTaxGroup[] = (await this.resolveTaxGroups(invoice))
            .filter(g => NumberUtilities.add(g.net, g.tax).isGreaterThan(0));
        const total: BigNumber = groups.reduce(
            (sum, g) => NumberUtilities.add(NumberUtilities.add(sum, g.net), g.tax),
            NumberUtilities.new(0)
        );
        let left: BigNumber = difference;
        const lines: NewJournalEntryLine[] = [];
        for (const [index, group] of groups.entries()) {
            // the last group takes what the rounding of the others left, so that the parts add up to the difference
            const part: BigNumber = index === groups.length - 1
                ? left
                : NumberUtilities.round(
                    NumberUtilities.divide(NumberUtilities.multiply(difference, NumberUtilities.add(group.net, group.tax)), total),
                    minorUnits
                );
            left = NumberUtilities.subtract(left, part);
            const tax: BigNumber = NumberUtilities.round(
                NumberUtilities.divide(NumberUtilities.multiply(part, group.vat.rate), 100 + group.vat.rate),
                minorUnits
            );
            lines.push(
                ...this.resolveLine(
                    this.resolveTaxAccount(rules, rules.rules.paymentDifferenceAccounts, group.vat.rate, 'difference'),
                    'debit',
                    NumberUtilities.subtract(part, tax)
                ),
                ...this.resolveLine(this.resolveTaxAccount(rules, rules.rules.outputTaxAccounts, group.vat.rate, 'output'), 'debit', tax)
            );
        }
        return this.mergeLines(lines);
    }

    /**
     * Finds the lines of the entry of the invoice a credit note credits in full: with the same totals before tax and
     * tax in each tax group.
     * @param creditNote - The credit note.
     * @param transaction - The transaction.
     * @returns The lines, or undefined for a partial credit note, or an invoice that was not posted.
     */
    protected async findFullyCreditedLines(creditNote: Invoice, transaction: Transaction): Promise<JournalEntryLine[] | undefined> {
        const reference: string | undefined = creditNote.precedingInvoices?.[0]?.number;
        if (reference == undefined) {
            return undefined;
        }
        const invoice: Invoice | undefined = await this.invoiceRepository.findOne({
            where: { number: reference, type: InvoiceType.INVOICE },
            required: false,
            transaction
        });
        if (invoice == undefined || !await this.hasSameTaxGroups(invoice, creditNote)) {
            return undefined;
        }
        const entry: JournalEntry | undefined = await this.entryRepository.findOne({
            where: { sourceType: PostingSourceType.INVOICE, sourceId: invoice.id },
            required: false,
            transaction
        });
        return entry == undefined
            ? undefined
            : await this.lineRepository.findAll({
                where: { entryId: entry.id },
                order: { chainSequence: 'ASC' },
                limit: 'all',
                transaction
            });
    }

    /**
     * Whether two invoices have the same totals before tax and the same tax in each tax group.
     * @param a - The one invoice.
     * @param b - The other invoice.
     * @returns True when they have.
     */
    protected async hasSameTaxGroups(a: Invoice, b: Invoice): Promise<boolean> {
        const describe: (groups: InvoiceTaxGroup[]) => string[] = groups => groups
            .map(g => `${g.vat.categoryCode} ${g.vat.rate} ${g.net.toFixed()} ${g.tax.toFixed()}`)
            .sort();
        const [first, second] = await Promise.all([this.resolveTaxGroups(a), this.resolveTaxGroups(b)]);
        return describe(first).join('|') === describe(second).join('|');
    }

    /**
     * Resolves the tax groups of an invoice, the way the invoice calc service calculates them.
     * @param invoice - The invoice.
     * @returns Each group with its total before tax and its tax.
     */
    protected async resolveTaxGroups(invoice: Invoice): Promise<InvoiceTaxGroup[]> {
        const calc: InvoiceCalcServiceInterface<Invoice> = inject<InvoiceCalcServiceInterface<Invoice>>(
            ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CALC_SERVICE
        );
        const groups: Vat[] = await calc.getTaxGroups(invoice, false);
        return await Promise.all(groups.map(async vat => ({
            vat,
            net: await calc.getTotalBeforeTaxForTaxGroup(invoice, vat, false),
            tax: await calc.getTotalTaxForTaxGroup(invoice, vat, false)
        })));
    }

    /**
     * Resolves the rules valid on a day: those of the rule set of its fiscal year with the latest `validFrom` on or
     * before it.
     * @param day - The day.
     * @param transaction - The transaction.
     * @returns The rules.
     * @throws A ConflictError for a day of no fiscal year, or of no rules.
     */
    protected async resolveRules(day: Date, transaction: Transaction): Promise<RulesOfDay> {
        const formatted: string = BookkeepingDayUtilities.formatDay(day);
        const fiscalYear: FiscalYear | undefined = await this.fiscalYearRepository.findOne({
            where: { start: { beforeOrOn: day }, end: { afterOrOn: day } },
            required: false,
            transaction
        });
        if (fiscalYear == undefined) {
            throw new ConflictError($ts`The posting date ${formatted} needs to fall into a fiscal year, and none covers it.`);
        }
        const [ruleSet] = await this.ruleSetRepository.findAll({
            where: { fiscalYearId: fiscalYear.id, validFrom: { beforeOrOn: day } },
            order: { validFrom: 'DESC' },
            limit: 1,
            transaction
        });
        if (ruleSet == undefined) {
            const [start, end] = [fiscalYear.start, fiscalYear.end].map(d => BookkeepingDayUtilities.formatDay(d));
            throw new ConflictError($ts`The fiscal year from ${start} to ${end} needs posting rules valid on ${formatted}, and has none.`);
        }
        return { rules: ruleSet.rules, day: formatted };
    }

    /**
     * Resolves the receivables account of the rules.
     * @param rules - The rules of a day.
     * @returns The id of the account.
     * @throws A ConflictError when they name none.
     */
    protected resolveReceivablesAccount(rules: RulesOfDay): string {
        if (rules.rules.receivablesAccountId == undefined) {
            throw new ConflictError($ts`The posting rules valid on ${rules.day} need to name a receivables account.`);
        }
        return rules.rules.receivablesAccountId;
    }

    /**
     * Resolves the payables account of the rules.
     * @param rules - The rules of a day.
     * @returns The id of the account.
     * @throws A ConflictError when they name none.
     */
    protected resolvePayablesAccount(rules: RulesOfDay): string {
        if (rules.rules.payablesAccountId == undefined) {
            throw new ConflictError($ts`The posting rules valid on ${rules.day} need to name a payables account.`);
        }
        return rules.rules.payablesAccountId;
    }

    /**
     * Resolves the revenue account of a VAT category and rate.
     * @param rules - The rules of a day.
     * @param vat - The VAT.
     * @returns The id of the account.
     * @throws A ConflictError when they name none.
     */
    protected resolveRevenueAccount(rules: RulesOfDay, vat: Vat): string {
        const account: string | undefined = rules.rules.revenueAccounts
            .find(r => r.categoryCode === vat.categoryCode && r.rate === vat.rate)?.accountId;
        if (account == undefined) {
            const category: string = vat.categoryCode;
            throw new ConflictError(
                $ts`The posting rules valid on ${rules.day} need to name a revenue account for the VAT ${category} ${vat.rate} %.`
            );
        }
        return account;
    }

    /**
     * Resolves the account of a VAT rate among the tax rules of one kind.
     * @param rules - The rules of a day.
     * @param accounts - The rules of the kind, such as the output tax accounts.
     * @param rate - The rate.
     * @param kind - Which kind they are, for the message.
     * @returns The id of the account.
     * @throws A ConflictError when they name none.
     */
    protected resolveTaxAccount(
        rules: RulesOfDay,
        accounts: PostingRuleTaxAccount[],
        rate: number,
        kind: 'output' | 'input' | 'difference'
    ): string {
        const account: string | undefined = accounts.find(a => a.rate === rate)?.accountId;
        if (account != undefined) {
            return account;
        }
        switch (kind) {
            case 'output': {
                throw new ConflictError($ts`The posting rules valid on ${rules.day} need to name an output tax account for ${rate} %.`);
            }
            case 'input': {
                throw new ConflictError($ts`The posting rules valid on ${rules.day} need to name an input tax account for ${rate} %.`);
            }
            case 'difference': {
                throw new ConflictError(
                    $ts`The posting rules valid on ${rules.day} need to name a payment difference account for ${rate} %.`
                );
            }
        }
    }

    /**
     * Resolves the account of the books of a bank account.
     * @param rules - The rules of a day.
     * @param bankAccountId - The id of the bank account.
     * @returns The id of the account.
     * @throws A ConflictError when they name none.
     */
    protected resolveBankAccount(rules: RulesOfDay, bankAccountId: string): string {
        const account: string | undefined = rules.rules.bankAccounts.find(b => b.bankAccountId === bankAccountId)?.accountId;
        if (account == undefined) {
            throw new ConflictError(
                $ts`The posting rules valid on ${rules.day} need to name the account of the bank account "${bankAccountId}".`
            );
        }
        return account;
    }

    /**
     * Validates rules before they are stored: each account they name is one of the books, and each rate, VAT category
     * and bank account is named once.
     * @param rules - The rules.
     * @param transaction - The transaction.
     * @throws A BadRequestError for something named twice, and a ConflictError for an account that is not one of the
     * books, such as one of another tenant.
     */
    protected async validateRules(rules: PostingRules, transaction: Transaction): Promise<void> {
        const keyed: [string, string[]][] = [
            ['revenueAccounts', rules.revenueAccounts.map(r => `${r.categoryCode} ${r.rate}`)],
            ['outputTaxAccounts', rules.outputTaxAccounts.map(r => String(r.rate))],
            ['inputTaxAccounts', rules.inputTaxAccounts.map(r => String(r.rate))],
            ['paymentDifferenceAccounts', rules.paymentDifferenceAccounts.map(r => String(r.rate))],
            ['bankAccounts', rules.bankAccounts.map(r => r.bankAccountId)]
        ];
        for (const [property, keys] of keyed) {
            const twice: string | undefined = keys.find((key, index) => keys.indexOf(key) !== index);
            if (twice != undefined) {
                throw new BadRequestError($ts`The ${property} of the posting rules need to name each one once, and name ${twice} twice.`);
            }
        }
        const ids: string[] = [
            ...new Set([
                ...rules.receivablesAccountId == undefined ? [] : [rules.receivablesAccountId],
                ...rules.payablesAccountId == undefined ? [] : [rules.payablesAccountId],
                ...rules.legalReserveAccountId == undefined ? [] : [rules.legalReserveAccountId],
                ...rules.reserveAllocationAccountId == undefined ? [] : [rules.reserveAllocationAccountId],
                ...[
                    ...rules.revenueAccounts,
                    ...rules.outputTaxAccounts,
                    ...rules.inputTaxAccounts,
                    ...rules.paymentDifferenceAccounts,
                    ...rules.bankAccounts
                ].map(r => r.accountId)
            ])
        ];
        const found: Set<string> = new Set((await this.accountRepository.findAll({
            where: { id: { oneOf: ids } },
            select: { id: true },
            limit: 'all',
            transaction
        })).map(a => a.id));
        const unknown: string | undefined = ids.find(id => !found.has(id));
        if (unknown != undefined) {
            throw new ConflictError($ts`The posting rules need to name accounts of the books, and "${unknown}" is none.`);
        }
    }

    /**
     * Validates that a source is in the currency of the books, which every amount of them is in.
     * @param currency - The currency of the source.
     * @param settings - The settings of the books.
     * @param source - What the source is, such as `The invoice 2026-ACME-0001`.
     * @throws A ConflictError for another currency.
     */
    protected validateCurrency(currency: string, settings: BookkeepingSettings, source: string): void {
        if (currency !== settings.currency) {
            throw new ConflictError($ts`${source} is in ${currency}, and needs to be in ${settings.currency}, the currency of the books.`);
        }
    }

    /**
     * Resolves the day a moment falls on in the default time zone of the application.
     * @param date - The moment, such as the date of an invoice.
     * @returns The day.
     */
    protected resolveDayOf(date: Date): Date {
        return BookkeepingDayUtilities.resolveDay(date, inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).defaultTimezone);
    }

    /**
     * Resolves a line of an amount, none for an amount of 0, which a line does not hold.
     * @param accountId - The id of the account.
     * @param side - The side.
     * @param amount - The amount.
     * @returns The line, or none.
     */
    protected resolveLine(accountId: string, side: Side, amount: BigNumber): NewJournalEntryLine[] {
        if (!amount.isGreaterThan(0)) {
            return [];
        }
        return [{ accountId, debit: side === 'debit' ? amount : null, credit: side === 'credit' ? amount : null }];
    }

    /**
     * Merges the lines on the same side of the same account into one, keeping the order they first appear in.
     * @param lines - The lines.
     * @returns The merged lines.
     */
    protected mergeLines(lines: NewJournalEntryLine[]): NewJournalEntryLine[] {
        const merged: Map<string, NewJournalEntryLine> = new Map();
        for (const line of lines) {
            const key: string = `${line.accountId}:${line.debit == undefined ? 'credit' : 'debit'}`;
            const existing: NewJournalEntryLine | undefined = merged.get(key);
            if (existing == undefined) {
                merged.set(key, { ...line });
                continue;
            }
            existing.debit = line.debit == undefined ? existing.debit : NumberUtilities.add(existing.debit ?? 0, line.debit);
            existing.credit = line.credit == undefined ? existing.credit : NumberUtilities.add(existing.credit ?? 0, line.credit);
        }
        return [...merged.values()];
    }

    /**
     * Resolves an entry of lines, posted and dated on the day of its document.
     * @param day - The day.
     * @param documentReference - The number of the document, or null for none.
     * @param text - What is booked.
     * @param lines - The lines.
     * @returns The entry, or undefined for no lines.
     */
    protected resolveEntryOf(
        day: Date,
        documentReference: string | null,
        text: string,
        lines: NewJournalEntryLine[]
    ): NewJournalEntry | undefined {
        return lines.length ? { documentDate: day, postingDate: day, documentReference, text, lines } : undefined;
    }

    /**
     * Runs work in the transaction given, or in one of its own.
     * @param transaction - The transaction of the caller, if any.
     * @param work - The work.
     * @returns What the work returns.
     */
    protected async runInTransaction<T>(transaction: Transaction | undefined, work: (transaction: Transaction) => Promise<T>): Promise<T> {
        return transaction == undefined
            ? await this.ruleSetRepository.dataSource.runInTransaction(work, { maxAttempts: 3 })
            : await work(transaction);
    }
}