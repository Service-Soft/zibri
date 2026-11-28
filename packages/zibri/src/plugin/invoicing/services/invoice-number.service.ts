import { type ZibriApplication } from '../../../application/application';
import { FrameworkColumnUtilities } from '../../../data-source/migration/framework-column.utilities';
import { Repository } from '../../../data-source/repository/repository';
import { NoActiveTenantError } from '../../../data-source/tenancy/no-active-tenant.error';
import { type RepositoryTransaction } from '../../../data-source/transaction/repository-transaction.type';
import { UniqueConstraintViolationError } from '../../../data-source/unique-constraint-violation.error';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { ConflictError } from '../../../error-handling/errors/conflict.error';
import { OnAppInit } from '../../../global/on-app-init.interface';
import { getZonedDate, ZonedDate } from '../../../localization/format-date.function';
import { $ts } from '../../../localization/translate.function';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { OmitStrict } from '../../../types/omit-strict.type';
import { PromiseUtilities } from '../../../utilities/promise.utilities';
import { validateEntitiesRegistered } from '../../../utilities/validate-entities-registered.function';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing.tokens';
import { CompanyInfo } from '../models/company-info.model';
import { InvoiceAddress } from '../models/invoice-address.model';
import { InvoiceNumberToken } from '../models/invoice-number-token.type';
import { InvoiceRecipientAbbreviation } from '../models/invoice-recipient-abbreviation.model';
import { Invoice } from '../models/invoice.model';
import { type InvoicingOptions } from '../models/invoicing-options.model';
import { NumberInvoices } from '../models/number-invoices.model';
import { NumberingContext } from '../models/numbering-context.model';
import { CompanyInfoServiceInterface } from './company-info-service.interface';
import { InvoiceNumberFormatUtilities } from './invoice-number-format.utilities';
import { InvoiceNumberServiceInterface } from './invoice-number-service.interface';

/**
 * Default implementation of the invoice number service.
 */
@Injectable({ register: 'onUse' })
export class InvoiceNumberService implements InvoiceNumberServiceInterface<InvoiceAddress>, OnAppInit {
    // the three below are read when used rather than injected: this is built at every boot that uses
    // the plugin, and ZibriInvoicingPlugin.validate names the entities that are missing - which it
    // could not, if building this had failed on a repository token first
    private get invoiceRepository(): Repository<Invoice, OmitStrict<Invoice, 'id'>> {
        return inject(repositoryTokenFor(Invoice));
    }

    // without the tenant, which the repository gives every counter it creates
    private get numberInvoicesRepository(): Repository<NumberInvoices, OmitStrict<NumberInvoices, 'id' | 'tenantId'>> {
        return inject(repositoryTokenFor(NumberInvoices));
    }

    private get recipientAbbreviationRepository(): Repository<
        InvoiceRecipientAbbreviation,
        OmitStrict<InvoiceRecipientAbbreviation, 'id' | 'tenantId'>
    > {
        return inject(repositoryTokenFor(InvoiceRecipientAbbreviation));
    }

    // read when used for the reason the repositories are: an application without one is told so by
    // ZibriInvoicingPlugin.validate rather than by a failed build of this
    private get companyInfoService(): CompanyInfoServiceInterface {
        return inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.COMPANY_INFO_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: InvoicingOptions
    ) {}

    /**
     * Gives the counters stored without a scope the scope they have: the year, the name abbreviation of their
     * recipient and the `separator`.
     * @param app - The application that starts.
     */
    async onAppInit(app: ZibriApplication): Promise<void> {
        // asked for before they are read, so that an application lacking them is refused naming them rather than
        // with the missing repository the read throws on
        validateEntitiesRegistered(InvoiceNumberService.name, app, NumberInvoices, InvoiceRecipientAbbreviation);
        // a table without the column, of a schema the data source does not manage, keeps every counter as 3.2 does
        if (!FrameworkColumnUtilities.hasColumns(NumberInvoices, 'scope')) {
            return;
        }
        // a counter without a scope is one of 3.2, stored before the upgrade or by an instance of 3.2 since,
        // which draws by year and recipient alone, as this release does for that scope. Keyed by the
        // abbreviation the recipient holds, which is the one their next number carries
        const unscoped: NumberInvoices[] = [];
        for await (const counter of this.numberInvoicesRepository.stream({ where: { scope: null }, acrossTenants: true })) {
            unscoped.push(counter);
        }
        if (!unscoped.length) {
            return;
        }
        const abbreviations: Map<string, string> = new Map();
        const recipientIds: string[] = [...new Set(unscoped.map(counter => counter.recipientId))];
        for await (const held of this.recipientAbbreviationRepository.stream({
            where: { recipientId: { oneOf: recipientIds } },
            acrossTenants: true
        })) {
            abbreviations.set(`${held.tenantId} ${held.recipientId}`, held.nameAbbreviation);
        }
        const separator: string = this.options.separator;
        // a counter whose recipient holds no abbreviation was never drawn from since 3.0, which claims one
        // with the first number, and is left as it is
        const scoped: NumberInvoices[] = unscoped.filter(counter => abbreviations.has(`${counter.tenantId} ${counter.recipientId}`));
        await PromiseUtilities.allChunked(scoped, async counter => {
            const abbreviation: string | undefined = abbreviations.get(`${counter.tenantId} ${counter.recipientId}`);
            try {
                await this.numberInvoicesRepository.updateById(
                    counter.id,
                    { scope: `${counter.year}${separator}${abbreviation}${separator}{counter}` },
                    { acrossTenants: true }
                );
            }
            catch (error) {
                // a counter of another format holding the same scope, such as one of the literal text
                // "2026-ACME-": this one is drawn from by its year and recipient, which it keeps
                if (!(error instanceof UniqueConstraintViolationError)) {
                    throw error;
                }
            }
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async generateInvoiceNumber(
        recipientId: string,
        invoiceAddress: InvoiceAddress,
        transaction: RepositoryTransaction | undefined,
        nameAbbreviation?: string
    ): Promise<string> {
        const context: NumberingContext = await this.resolveContext();
        const format: string = this.resolveInvoiceFormat(context);
        // before the counter is touched, so a refused abbreviation draws no number - with a
        // transaction or without one, where a drawn number would stay drawn. Only for a format
        // naming it: an application numbering without one claims none
        const recipient: string | undefined = InvoiceNumberFormatUtilities.hasToken(format, 'recipient')
            ? await this.resolveNameAbbreviation(recipientId, invoiceAddress, nameAbbreviation, transaction)
            : undefined;
        const [before, after] = InvoiceNumberFormatUtilities.resolveParts(format, { ...this.getDateValues(context.date), recipient });
        const scope: string = `${before}{counter}${after}`;
        const [year, counterRecipientId] = this.getCounterKey(scope, context.date.year, recipientId, recipient);
        if (counterRecipientId !== recipientId) {
            // kept apart from the counters of the default format by its scope, which a table of a schema the data source
            // does not manage may lack
            FrameworkColumnUtilities.validatePresent(`Numbering invoices in the format "${format}"`, NumberInvoices, 'scope');
        }
        // a counter kept under the key of 3.2 is drawn through the method a class of 3.2 overrides, which
        // draws through resolveCounter unless it is overridden
        const counter: string = counterRecipientId === recipientId
            // eslint-disable-next-line typescript/no-deprecated -- called until 4.0, for a class of 3.2 overriding it
            ? await this.resolveConsecutiveNumber(counterRecipientId, year, transaction, scope)
            : String(await this.resolveCounter(scope, year, counterRecipientId, transaction)).padStart(this.options.numberOfDigits, '0');
        const result: string = `${before}${counter}${after}`;
        await this.validateInvoiceNumber(result);
        return result;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async generateTemporaryInvoiceNumber(recipientId: string, invoiceAddress: InvoiceAddress, nameAbbreviation?: string): Promise<string> {
        const context: NumberingContext = await this.resolveContext();
        const format: string = this.resolveInvoiceFormat(context);
        // read rather than claimed: a temporary number draws nothing, and the number it is replaced
        // with claims the abbreviation then
        const recipient: string | undefined = InvoiceNumberFormatUtilities.hasToken(format, 'recipient')
            ? await this.findHeldNameAbbreviation(recipientId, invoiceAddress, nameAbbreviation)
            : undefined;
        const [before, after] = InvoiceNumberFormatUtilities.resolveParts(format, { ...this.getDateValues(context.date), recipient });
        const [year, counterRecipientId] = this.getCounterKey(`${before}{counter}${after}`, context.date.year, recipientId, recipient);
        // through the method a class of 3.2 overrides, as generateInvoiceNumber draws
        const counter: string = counterRecipientId === recipientId
            // eslint-disable-next-line typescript/no-deprecated -- called until 4.0, for a class of 3.2 overriding it
            ? await this.resolveTemporaryConsecutiveNumber(counterRecipientId, year)
            : String(await this.resolveTemporaryCounter(year, counterRecipientId)).padStart(this.options.numberOfDigits, '0');

        const result: string = `TEMP${this.options.separator}${before}${counter}${after}`;
        if (!await this.invoiceRepository.findOne({ where: { number: result }, required: false })) {
            return result;
        }

        let suffix: number = 2;
        while (await this.invoiceRepository.findOne({
            where: { number: `${result}${this.options.separator}${suffix}` },
            required: false
        })) {
            suffix++;
        }
        return `${result}${this.options.separator}${suffix}`;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async generateCreditNoteNumber(invoiceNumber: string, transaction?: RepositoryTransaction): Promise<string> {
        const context: NumberingContext = await this.resolveContext();
        const format: string = context.company.creditNoteNumberFormat ?? InvoiceNumberFormatUtilities.getCreditNoteFormat(this.options);
        InvoiceNumberFormatUtilities.validateCreditNoteFormat(
            format,
            `creditNoteNumberFormat of the company of the tenant ${context.tenantId}`
        );
        const [before, after] = InvoiceNumberFormatUtilities.resolveParts(format, {
            ...this.getDateValues(context.date),
            invoice: invoiceNumber
        });
        // a credit note has no recipient of its own, and its scope is never one 3.2 draws in
        const scope: string = `${before}{counter}${after}`;
        const [year, counterRecipientId] = this.getCounterKey(scope, context.date.year, '', undefined);
        FrameworkColumnUtilities.validatePresent('Numbering credit notes', NumberInvoices, 'scope');
        const counter: number = await this.resolveCounter(scope, year, counterRecipientId, transaction);
        // the default for options written out whole for 3.2, which have none
        const result: string = `${before}${String(counter).padStart(this.options.creditNoteNumberOfDigits ?? 1, '0')}${after}`;
        await this.validateInvoiceNumber(result);
        return result;
    }

    /**
     * Resolves the company issuing an invoice numbered now, and the moment in its time zone, whose calendar
     * year, month and day the number is drawn in.
     * @returns The company and the moment.
     * @throws A NoActiveTenantError outside a tenant, where no company issues it.
     */
    protected async resolveNumberingContext(): Promise<NumberingContext> {
        const tenantId: string | undefined = inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).getActiveTenantId();
        if (tenantId == undefined) {
            throw new NoActiveTenantError(NumberInvoices);
        }
        const company: CompanyInfo = await this.companyInfoService.resolveCompanyInfo(tenantId);
        return { tenantId, company, date: getZonedDate(new Date(), company.timezone) };
    }

    /**
     * Resolves the year an invoice issued now is numbered in: the year of the moment `resolveNumberingContext`
     * answers.
     * @deprecated Override `resolveNumberingContext`, whose `date` is the moment a number is drawn at. A class
     * of your own overriding this numbers in the year it answers, its `{month}` still the one of that moment.
     * Removed in 4.0.
     * @param context - The context of the number, resolved when none is passed.
     * @returns The year.
     * @throws A NoActiveTenantError outside a tenant, where no company issues it.
     */
    protected async resolveCurrentYear(context?: NumberingContext): Promise<number> {
        return (context ?? await this.resolveNumberingContext()).date.year;
    }

    /**
     * Gets the temporary consecutive number of the invoices of a recipient in a year, the counter of the default
     * number format, prefixed with zeroes to `numberOfDigits`.
     * @deprecated Override `resolveTemporaryCounter`, which reads the counters of every format. A class of your
     * own overriding this is called for the numbers of the default format alone, the year, the name abbreviation
     * and the counter with the `separator` between them, and not for those of any other `numberFormat`.
     * Removed in 4.0.
     * @param recipientId - The id of the recipient of the invoice.
     * @param currentYear - The year the invoice is numbered in.
     * @returns The number, filled up with zeroes to `numberOfDigits`.
     */
    protected async resolveTemporaryConsecutiveNumber(recipientId: string, currentYear: number): Promise<string> {
        return String(await this.resolveTemporaryCounter(currentYear, recipientId)).padStart(this.options.numberOfDigits, '0');
    }

    /**
     * Draws the next consecutive number of the invoices of a recipient in a year, the counter of the default
     * number format, prefixed with zeroes to `numberOfDigits`.
     * @deprecated Override `resolveCounter`, which draws the numbers of every format. A class of your own
     * overriding this is called for the numbers of the default format alone, the year, the name abbreviation and
     * the counter with the `separator` between them, and not for those of any other `numberFormat` or of credit
     * notes. Removed in 4.0.
     * @param recipientId - The id of the recipient of the invoice.
     * @param currentYear - The year the invoice is numbered in.
     * @param transaction - An optional transaction from outside to make sure any changes only apply when the transaction is committed.
     * @param scope - The format rendered without its counter, which a counter created for it records. A counter
     * created without one is given its scope by the next start.
     * @returns The number, filled up with zeroes to `numberOfDigits`.
     */
    protected async resolveConsecutiveNumber(
        recipientId: string,
        currentYear: number,
        transaction: RepositoryTransaction | undefined,
        scope?: string
    ): Promise<string> {
        // without a scope when a class of 3.2 calls it through super: drawn by year and recipient as 3.2 draws,
        // which the next start gives the scope it has
        const counter: number = scope == undefined
            ? (await this.numberInvoicesRepository.upsert(
                { year: currentYear, recipientId },
                { year: currentYear, recipientId, number: 1 },
                { number: { increment: 1 } },
                { transaction }
            )).number
            : await this.resolveCounter(scope, currentYear, recipientId, transaction);
        return String(counter).padStart(this.options.numberOfDigits, '0');
    }

    /**
     * Resolves the context a number is drawn in, in the year `resolveCurrentYear` answers.
     * @returns The context.
     */
    // TODO 4.0: gone with resolveCurrentYear, resolveNumberingContext called in its place
    private async resolveContext(): Promise<NumberingContext> {
        const context: NumberingContext = await this.resolveNumberingContext();
        // eslint-disable-next-line typescript/no-deprecated -- called until 4.0, for a class of 3.2 overriding it
        const year: number = await this.resolveCurrentYear(context);
        return year === context.date.year ? context : { ...context, date: { ...context.date, year } };
    }

    private async findHeldNameAbbreviation(
        recipientId: string,
        invoiceAddress: InvoiceAddress,
        nameAbbreviation: string | undefined
    ): Promise<string> {
        if (nameAbbreviation != undefined) {
            return nameAbbreviation;
        }
        const held: InvoiceRecipientAbbreviation | undefined = await this.recipientAbbreviationRepository.findOne(
            { where: { recipientId }, required: false }
        );
        return held?.nameAbbreviation ?? this.getSuggestedNameAbbreviation(invoiceAddress);
    }

    private resolveInvoiceFormat(context: NumberingContext): string {
        if (context.company.numberFormat == undefined) {
            // validated at boot
            return InvoiceNumberFormatUtilities.getInvoiceFormat(this.options);
        }
        InvoiceNumberFormatUtilities.validateInvoiceFormat(
            context.company.numberFormat,
            `numberFormat of the company of the tenant ${context.tenantId}`
        );
        return context.company.numberFormat;
    }

    private getDateValues(date: ZonedDate): Partial<Record<InvoiceNumberToken, string>> {
        return {
            year: String(date.year),
            yy: String(date.year % 100).padStart(2, '0'),
            month: String(date.month + 1).padStart(2, '0')
        };
    }

    /**
     * Gets the year and recipient id a counter is kept under: the year and the recipient for a scope of the
     * year, the name abbreviation and the count with the `separator` between them, the default format, and 0
     * and the scope itself for any other.
     * @param scope - The format rendered without its counter.
     * @param year - The year the number is drawn in.
     * @param recipientId - The recipient it is drawn for.
     * @param recipient - The name abbreviation it is drawn with, if the format names one.
     * @returns The year and the recipient id.
     */
    // TODO 4.0: gone with the key on year and recipient. Until then an instance of 3.2 draws the numbers of
    // its format by that key, beside this release and after going back to 3.2, so a counter of that scope is
    // one it finds and increments. Every other counter takes a year no invoice is numbered in, which keeps
    // it apart from those, and its scope, which keeps it unique
    protected getCounterKey(scope: string, year: number, recipientId: string, recipient: string | undefined): [number, string] {
        const separator: string = this.options.separator;
        return recipient != undefined && scope === `${year}${separator}${recipient}${separator}{counter}`
            ? [year, recipientId]
            : [0, scope];
    }

    /**
     * Gets what the next number drawn from a counter would be, without drawing it.
     * @param year - The year the counter is kept under, see `getCounterKey`.
     * @param recipientId - The recipient id the counter is kept under.
     * @returns The number.
     */
    protected async resolveTemporaryCounter(year: number, recipientId: string): Promise<number> {
        const counter: NumberInvoices | undefined = await this.numberInvoicesRepository.findOne({
            where: { year, recipientId },
            required: false
        });
        return (counter?.number ?? 0) + 1;
    }

    /**
     * Draws the next number of a scope.
     * @param scope - The format rendered without its counter, which a counter created for it records.
     * @param year - The year the counter is kept under, see `getCounterKey`.
     * @param recipientId - The recipient id the counter is kept under.
     * @param transaction - An optional transaction from outside to make sure any changes only apply when the transaction is committed.
     * @returns The number.
     */
    protected async resolveCounter(
        scope: string,
        year: number,
        recipientId: string,
        transaction: RepositoryTransaction | undefined
    ): Promise<number> {
        // One upsert, because nothing weaker holds. Reading the counter and writing it back is a
        // race whether or not it runs under a lock: the lock only covers the window it is held for,
        // and with a transaction the write lands on commit - after that window has closed. Two
        // callers then both read 41, both write 42, and two invoices carry the same legally binding
        // number. Only an increment with no window to interleave in avoids that.
        //
        // Staying inside the caller's transaction is deliberate. The number rolls back with the
        // invoice it was drawn for, so an abandoned invoice leaves no gap in the sequence - which is
        // the whole reason a counter is used here rather than a database sequence.
        //
        // Keyed by the rendered format: two formats rendering the same scope count on together, so a
        // format changed in the middle of a year never draws a number twice. Identified by year and
        // recipient, which getCounterKey derives from the scope: the key an instance of 3.2 draws by. A
        // counter it created has no scope, and is left without one until the next start gives it one.
        const counter: NumberInvoices = await this.numberInvoicesRepository.upsert(
            { year, recipientId },
            { scope, year, recipientId, number: 1 },
            { number: { increment: 1 } },
            { transaction }
        );
        return counter.number;
    }

    /**
     * Resolves the name abbreviation a recipient's invoice is numbered with, claiming it for the
     * recipient when they hold none yet or are given another one.
     *
     * Two recipients sharing one would draw the same numbers from their own counters, so each one
     * belongs to one recipient.
     * @param recipientId - The id of the recipient of the invoice.
     * @param invoiceAddress - The address data of the recipient, which the abbreviation is suggested from.
     * @param nameAbbreviation - The abbreviation to number with from now on, if not the one the
     * recipient holds or, holding none, the suggested one.
     * @param transaction - The transaction the number is drawn in, which a claim rolls back with.
     * @returns The abbreviation.
     * @throws A ConflictError when another recipient holds the abbreviation.
     */
    protected async resolveNameAbbreviation(
        recipientId: string,
        invoiceAddress: InvoiceAddress,
        nameAbbreviation: string | undefined,
        transaction: RepositoryTransaction | undefined
    ): Promise<string> {
        const held: InvoiceRecipientAbbreviation | undefined = await this.recipientAbbreviationRepository.findOne(
            { where: { recipientId }, transaction, required: false }
        );
        if (held != undefined && (nameAbbreviation == undefined || nameAbbreviation === held.nameAbbreviation)) {
            return held.nameAbbreviation;
        }
        const claimed: string = nameAbbreviation ?? this.getSuggestedNameAbbreviation(invoiceAddress);
        // claimed by the unique constraint rather than checked before, which two recipients claiming
        // one at the same moment would both pass. One upsert rather than a create, because the first
        // invoices of one recipient drawn at the same moment all claim it, and they claim the same.
        // An abbreviation a recipient gives up is free again; a number of theirs that year it is
        // claimed again for is refused as one that exists
        try {
            await this.recipientAbbreviationRepository.upsert(
                { recipientId },
                { recipientId, nameAbbreviation: claimed },
                { nameAbbreviation: { set: claimed } },
                { transaction }
            );
        }
        catch (error) {
            if (error instanceof UniqueConstraintViolationError && error.properties.includes('nameAbbreviation')) {
                throw new ConflictError($ts`The name abbreviation ${claimed} is already used by another recipient.`, { cause: error });
            }
            throw error;
        }
        return claimed;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getSuggestedNameAbbreviation(invoiceAddress: InvoiceAddress): string {
        return invoiceAddress.company && invoiceAddress.companyName
            ? this.getCompanyNameAbbreviation(invoiceAddress.companyName)
            : this.getPrivateCustomerAbbreviation(invoiceAddress);
    }

    private getPrivateCustomerAbbreviation(invoiceAddress: InvoiceAddress): string {
        let res: string = '';
        for (let i: number = 0; i < this.options.numberPrivateCustomerAbbreviationCharacters; i++) {
            if (invoiceAddress.firstName[i]) {
                res += invoiceAddress.firstName[i];
            }
        }
        for (let i: number = 0; i < this.options.numberPrivateCustomerAbbreviationCharacters; i++) {
            if (invoiceAddress.lastName[i]) {
                res += invoiceAddress.lastName[i];
            }
        }
        return res.toUpperCase();
    }

    private getCompanyNameAbbreviation(companyName: string): string {
        companyName = companyName.replaceAll(/\s/g, '');
        companyName = companyName.replaceAll(/[^\da-z]/gi, '');
        let res: string = '';
        for (let i: number = 0; i < this.options.numberCompanyAbbreviationCharacters; i++) {
            if (companyName[i]) {
                res += companyName[i];
            }
        }
        return res.toUpperCase();
    }

    /**
     * Validates the given invoice number.
     * @param invoiceNumber - The invoice number to validate.
     */
    protected async validateInvoiceNumber(invoiceNumber: string): Promise<void> {
        if (await this.invoiceRepository.findOne({ where: { number: invoiceNumber }, required: false })) {
            throw new ConflictError($ts`The generated invoice-number ${invoiceNumber} already exists!`);
        }
    }
}