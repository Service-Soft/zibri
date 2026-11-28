import { type Readable } from 'node:stream';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AnyLevelPermissions } from '../../auth/models/any-level-permissions.model';
import { PaginationResult } from '../../data-source/models/pagination-result.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { MimeType } from '../../http/mime-type.enum';
import { type LocaleCode } from '../../localization/models/locale-code.model';
import { type Timezone } from '../../localization/models/timezone.model';
import { $ts } from '../../localization/translate.function';
import { Response } from '../../open-api/decorators/response.decorator';
import { FileResponse } from '../../parsing/form-data/file-response.model';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from './invoicing.tokens';
import { type CompanyInfo } from './models/company-info.model';
import { type InvoiceArchiveOptions } from './models/invoice-archive-options.model';
import { type InvoiceDocument } from './models/invoice-document.model';
import { InvoiceType } from './models/invoice-type.enum';
import { Invoice } from './models/invoice.model';
import { ZibriInvoicingPermissions, ZibriInvoicingPlatformPermissions } from './models/zibri-invoicing-permissions.model';
import { type InvoiceConformance } from './services/conformance/invoice-conformance-service.interface';
import { type InvoiceDocumentServiceInterface } from './services/invoice-document-service.interface';
import { type InvoiceServiceInterface } from './services/invoice-service.interface';

/**
 * The most rows a page of the invoices holds.
 */
const MAX_LIMIT: number = 100;

const READ: AnyLevelPermissions = {
    permission: ZibriInvoicingPermissions.INVOICING_INVOICES_READ,
    platformPermission: ZibriInvoicingPlatformPermissions.INVOICING_INVOICES_READ_ALL
};

/**
 * How the documents of an invoice without archived ones are rendered, such as a draft.
 */
type InvoiceRendering = {
    /**
     * The locale of the pdf.
     */
    locale: LocaleCode,
    /**
     * The time zone its dates are read in, that of the company issuing it.
     */
    timezone: Timezone,
    /**
     * The electronic invoice it carries, if any.
     */
    conformance: InvoiceConformance | undefined
};

/**
 * The routes of the invoices and credit notes of the tenant of the request, below the path of the controller that
 * extends it: listing them, reading one, and its pdf and electronic invoice, those archived at its issue, or rendered of
 * a draft. Each is behind `invoicing.invoices.read` of `ZIBRI_INVOICING_PERMISSIONS`, or
 * `invoicing.invoices.read_all` of `ZIBRI_INVOICING_PLATFORM_PERMISSIONS`, which reaches the invoices of every tenant in
 * a request naming no tenant: a route naming an invoice reaches its tenant, and the list takes the `tenantId`.
 */
// no @Controller of its own, for the reason MailingListController has none: the application's class extending this
// one says where the routes are. Every decorator is on a route rather than the class, which the application's class
// would not inherit
export class InvoicingController {
    // read when used rather than injected, for the reason MailingListController reads its repository so
    private get invoiceRepository(): Repository<Invoice> {
        return inject(repositoryTokenFor(Invoice));
    }

    private get invoiceService(): InvoiceServiceInterface {
        return inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_SERVICE);
    }

    private get documentService(): InvoiceDocumentServiceInterface {
        return inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_DOCUMENT_SERVICE);
    }

    private get tenantService(): TenantServiceInterface {
        return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.paginated(Invoice)
    @Get('/invoices')
    async findInvoices(
        @Param.query('page', { type: 'number', format: 'integer', min: 1 })
        page: number,
        @Param.query('limit', { type: 'number', format: 'integer', min: 1, max: MAX_LIMIT })
        limit: number,
        @Param.query('search', { type: 'string', required: false })
        search: string | undefined,
        @Param.query('issued', { type: 'boolean', required: false })
        issued: boolean | undefined,
        @Param.query('type', { type: 'string', enum: InvoiceType, required: false })
        type: InvoiceType | undefined,
        @Param.query('open', { type: 'boolean', required: false })
        open: boolean | undefined,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<PaginationResult<Invoice>> {
        return await this.runInTenantOf(
            user,
            // eslint-disable-next-line typescript/require-await
            async () => {
                if (tenantId == undefined) {
                    throw new BadRequestError($ts`A request naming no tenant needs to name the tenantId of the invoices.`);
                }
                return tenantId;
            },
            async () => await this.invoiceService.findInvoices(page, limit, { search, issued, type, open })
        );
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.object(Invoice)
    @Get('/invoices/:id')
    async findInvoice(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<Invoice> {
        return await this.runInTenantOfInvoice(user, id, async () => await this.invoiceRepository.findById(id));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.file()
    @Get('/invoices/:id/pdf')
    async resolvePdf(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<FileResponse> {
        return await this.runInTenantOfInvoice(user, id, async () => {
            const invoice: Invoice = await this.invoiceRepository.findById(id);
            const rendering: InvoiceRendering = await this.resolveRendering(invoice);
            const pdf: Readable = await this.documentService.resolvePdf(
                invoice,
                rendering.locale,
                rendering.timezone,
                rendering.conformance,
                undefined
            );
            return FileResponse.fromStream({ stream: pdf, filename: `${invoice.number}.pdf`, mimeType: MimeType.PDF });
        });
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.file()
    @Get('/invoices/:id/electronic-invoice')
    async resolveElectronicInvoice(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @Param.query('conformance', { type: 'string', required: false })
        conformance: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<FileResponse> {
        return await this.runInTenantOfInvoice(user, id, async () => {
            const invoice: Invoice = await this.invoiceRepository.findById(id);
            const archived: InvoiceDocument | undefined = invoice.issuedAt == undefined
                ? undefined
                : await this.documentService.findDocument(id);
            const rendering: InvoiceRendering = await this.resolveRendering(invoice);
            let rendered: InvoiceConformance;
            if (archived == undefined) {
                // a preview, as the conformance named or the archive would write it
                rendered = this.resolvePreviewConformance(conformance ?? rendering.conformance);
            }
            else {
                // the electronic invoice it was archived as, whatever the request or the options say since
                if (archived.conformance == undefined) {
                    throw new NotFoundError($ts`The invoice ${invoice.number} has no electronic invoice.`);
                }
                rendered = archived.conformance;
            }
            const xml: Readable = await this.documentService.resolveElectronicInvoice(invoice, rendered, rendering.timezone);
            return FileResponse.fromStream({ stream: xml, filename: `${invoice.number}.xml`, mimeType: MimeType.XML });
        });
    }

    /**
     * Resolves the conformance the electronic invoice of an invoice without archived documents is written in.
     * @param conformance - The conformance the request names, or the archive of the options would write.
     * @returns The conformance.
     * @throws A BadRequestError for none, and for one that is not registered or writes no xml of its own, naming those
     * that do.
     */
    protected resolvePreviewConformance(conformance: InvoiceConformance | undefined): InvoiceConformance {
        const writing: string[] = inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CONFORMANCE_SERVICES)
            .filter(s => s.generateXml != undefined)
            .map(s => s.name);
        if (conformance == undefined || !writing.includes(conformance)) {
            throw new BadRequestError($ts`The conformance needs to be one of ${writing.join(', ')}.`);
        }
        return conformance;
    }

    /**
     * Resolves how the documents of an invoice without archived ones are rendered: in the locale and as the electronic
     * invoice of the `archive` of the options, as an issued invoice would be archived, or in the locale of the request
     * and as a pdf alone without it, in the time zone of the company of its tenant.
     * @param invoice - The invoice.
     * @returns The locale, time zone and electronic invoice.
     */
    protected async resolveRendering(invoice: Invoice): Promise<InvoiceRendering> {
        const archive: InvoiceArchiveOptions | undefined = inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS).archive;
        const company: CompanyInfo = await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.COMPANY_INFO_SERVICE)
            .resolveCompanyInfo(invoice.tenantId);
        return {
            locale: archive?.locale
                ?? inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).resolveSupportedLocale(inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT)),
            timezone: company.timezone,
            conformance: archive?.resolveConformance(invoice)
        };
    }

    /**
     * Runs work in the tenant of an invoice: the tenant of the request, or, for a request naming none, the tenant the
     * invoice belongs to, which only the platform permission reaches.
     * @param user - The caller.
     * @param invoiceId - The id of the invoice.
     * @param work - The work.
     * @returns What the work returns.
     */
    private async runInTenantOfInvoice<T>(user: CurrentUser, invoiceId: string, work: () => Promise<T>): Promise<T> {
        return await this.runInTenantOf(
            user,
            async () => (await this.invoiceRepository.findById(invoiceId, { acrossTenants: true })).tenantId,
            work
        );
    }

    /**
     * Runs work in the tenant of the request, or, for a request naming none, in the tenant of what the route names,
     * which only the platform permission reaches.
     * @param user - The caller.
     * @param resolveTenantId - Resolves the tenant of what the route names.
     * @param work - The work.
     * @returns What the work returns.
     * @throws A ForbiddenError for a request naming no tenant of a caller without the platform permission.
     */
    private async runInTenantOf<T>(user: CurrentUser, resolveTenantId: () => Promise<string>, work: () => Promise<T>): Promise<T> {
        if (this.tenantService.getActiveTenantId() != undefined) {
            return await work();
        }
        // @Auth.hasAnyLevelPermission lets a request naming no tenant through by the platform permission alone. Asked
        // again here, as the tenant permission reaching the invoices of every tenant is the one thing these routes may
        // never do
        if (!user.platformPermissions.includes(READ.platformPermission)) {
            throw new ForbiddenError($ts`You do not have permission to access this route.`);
        }
        return await this.tenantService.runAs(await resolveTenantId(), work);
    }
}