import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { Auth } from '../../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { AnyLevelPermissions } from '../../../auth/models/any-level-permissions.model';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { ForbiddenError } from '../../../error-handling/errors/forbidden.error';
import { FilePropertyUtilities } from '../../../file/file-property.utilities';
import { HttpStatus } from '../../../http/http-status.enum';
import { MimeType } from '../../../http/mime-type.enum';
import { $ts } from '../../../localization/translate.function';
import { Response } from '../../../open-api/decorators/response.decorator';
import { FileResponse } from '../../../parsing/form-data/file-response.model';
import { FormData } from '../../../parsing/form-data/form-data.model';
import { Body } from '../../../routing/decorators/body.decorator';
import { Delete } from '../../../routing/decorators/delete.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { Param } from '../../../routing/decorators/param.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { Put } from '../../../routing/decorators/put.decorator';
import { CrudControllerFileUtilities } from '../../../routing/models/crud-controller-file.utilities';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { FsUtilities } from '../../../utilities/fs.utilities';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { FiscalYear } from '../models/fiscal-year.model';
import { ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS } from './e-bilanz.tokens';
import { EBilanzAccountMappingInput } from './models/e-bilanz-account-mapping-input.model';
import { EBilanzAccountMapping } from './models/e-bilanz-account-mapping.model';
import { EBilanzCertificateUpload } from './models/e-bilanz-certificate-upload.model';
import { EBilanzFiling, type EBilanzFilingCreateData } from './models/e-bilanz-filing.model';
import { EBilanzPreparationInput } from './models/e-bilanz-preparation-input.model';
import { EBilanzPreparation } from './models/e-bilanz-preparation.model';
import { EBilanzProtocolUpload } from './models/e-bilanz-protocol-upload.model';
import { EBilanzSettingsView } from './models/e-bilanz-settings-view.model';
import { type EBilanzSettings } from './models/e-bilanz-settings.model';
import { EBilanzState } from './models/e-bilanz-state.model';
import { ZibriEBilanzPermissions, ZibriEBilanzPlatformPermissions } from './models/zibri-e-bilanz-permissions.model';
import { type EBilanzExport, type EBilanzFile, type EBilanzServiceInterface } from './services/e-bilanz-service.interface';

const READ: AnyLevelPermissions = {
    permission: ZibriEBilanzPermissions.BOOKKEEPING_E_BILANZ_READ,
    platformPermission: ZibriEBilanzPlatformPermissions.BOOKKEEPING_E_BILANZ_READ_ALL
};
const PREPARE: AnyLevelPermissions = {
    permission: ZibriEBilanzPermissions.BOOKKEEPING_E_BILANZ_PREPARE,
    platformPermission: ZibriEBilanzPlatformPermissions.BOOKKEEPING_E_BILANZ_PREPARE_ALL
};
const TRANSMIT: AnyLevelPermissions = {
    permission: ZibriEBilanzPermissions.BOOKKEEPING_E_BILANZ_TRANSMIT,
    platformPermission: ZibriEBilanzPlatformPermissions.BOOKKEEPING_E_BILANZ_TRANSMIT_ALL
};
const MANAGE: AnyLevelPermissions = {
    permission: ZibriEBilanzPermissions.BOOKKEEPING_E_BILANZ_MANAGE,
    platformPermission: ZibriEBilanzPlatformPermissions.BOOKKEEPING_E_BILANZ_MANAGE_ALL
};

/**
 * The routes of the E-Bilanz of the books of the tenant of the request, below the path of the controller that extends
 * it: the E-Bilanz of a closed fiscal year with what it needs and the records of its filing, preparing it, exporting
 * it, sending it as a test and for real, recording it as filed by hand, the ELSTER certificate, and the accounts mapped
 * to a position of their own. The company it states is set by the routes of the bookkeeping settings. Each is behind a permission of `ZIBRI_E_BILANZ_PERMISSIONS`, or
 * the one of `ZIBRI_E_BILANZ_PLATFORM_PERMISSIONS` beside it in a request naming no tenant.
 */
// no @Controller of its own, as BookkeepingController has none: the application's class extending it says where the
// routes are, and that the application has them at all
export class EBilanzController {
    private get eBilanzService(): EBilanzServiceInterface {
        return inject(ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.E_BILANZ_SERVICE);
    }

    private get fiscalYearRepository(): Repository<FiscalYear> {
        return inject(repositoryTokenFor(FiscalYear));
    }

    private get filingRepository(): Repository<EBilanzFiling, EBilanzFilingCreateData> {
        return inject(repositoryTokenFor(EBilanzFiling));
    }

    private get tenantService(): TenantServiceInterface {
        return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.object(EBilanzState)
    @Get('/fiscal-years/:id')
    async resolveState(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<EBilanzState> {
        return await this.runInTenantOfFiscalYear(user, READ, id, async () => await this.eBilanzService.resolveState(id));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.object(EBilanzPreparation)
    @Post('/fiscal-years/:id/preview')
    async resolvePreparation(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @Body(EBilanzPreparationInput)
        input: EBilanzPreparationInput,
        @CurrentUser()
        user: CurrentUser
    ): Promise<EBilanzPreparation> {
        return await this.runInTenantOfFiscalYear(user, READ, id, async () => await this.eBilanzService.resolvePreparation(id, input));
    }

    @Auth.hasAnyLevelPermission(PREPARE)
    @Response.object(EBilanzFiling)
    @Post('/fiscal-years/:id/preparation')
    async prepare(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @Body(EBilanzPreparationInput)
        input: EBilanzPreparationInput,
        @CurrentUser()
        user: CurrentUser
    ): Promise<EBilanzFiling> {
        return await this.runInTenantOfFiscalYear(user, PREPARE, id, async () => await this.eBilanzService.prepare(id, input, user.id));
    }

    @Auth.hasAnyLevelPermission(PREPARE)
    @Response.file()
    @Get('/fiscal-years/:id/export')
    async resolveExport(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @Param.query('exporter', { type: 'string' })
        exporter: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<FileResponse> {
        const file: EBilanzExport = await this.runInTenantOfFiscalYear(
            user,
            PREPARE,
            id,
            async () => await this.eBilanzService.resolveExport(id, exporter)
        );
        return FileResponse.fromStream({ stream: Readable.from(file.data), filename: file.name, mimeType: file.mimeType });
    }

    @Auth.hasAnyLevelPermission(TRANSMIT)
    // answered once the start is recorded: the result is polled from GET /fiscal-years/:id
    @Response.object(EBilanzFiling, { status: HttpStatus.ACCEPTED })
    @Post('/fiscal-years/:id/test-transmission')
    async transmitTest(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<EBilanzFiling> {
        return await this.runInTenantOfFiscalYear(
            user,
            TRANSMIT,
            id,
            async () => await this.eBilanzService.transmit(id, { test: true }, user.id)
        );
    }

    @Auth.hasAnyLevelPermission(TRANSMIT)
    // the one route filing with the tax administration, which a stolen session is not to reach
    @Auth.require2fa({ reauth: true })
    @Response.object(EBilanzFiling, { status: HttpStatus.ACCEPTED })
    @Post('/fiscal-years/:id/transmission')
    async transmit(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<EBilanzFiling> {
        return await this.runInTenantOfFiscalYear(
            user,
            TRANSMIT,
            id,
            async () => await this.eBilanzService.transmit(id, { test: false }, user.id)
        );
    }

    @Auth.hasAnyLevelPermission(TRANSMIT)
    // it lets the E-Bilanz be sent again, as the transmission route does
    @Auth.require2fa({ reauth: true })
    @Response.array(EBilanzFiling)
    @Post('/fiscal-years/:id/transmission-not-received')
    async recordNotReceived(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<EBilanzFiling[]> {
        return await this.runInTenantOfFiscalYear(user, TRANSMIT, id, async () => await this.eBilanzService.recordNotReceived(id, user.id));
    }

    @Auth.hasAnyLevelPermission(TRANSMIT)
    @Response.object(EBilanzFiling)
    @Post('/fiscal-years/:id/manual-filing')
    async recordManualFiling(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @Body(EBilanzProtocolUpload, { type: MimeType.FORM_DATA })
        form: FormData<EBilanzProtocolUpload>,
        @CurrentUser()
        user: CurrentUser
    ): Promise<EBilanzFiling> {
        try {
            const data: Buffer = await buffer(FsUtilities.createReadStream(form.value.protocol.path));
            const protocol: EBilanzFile = { name: form.value.protocol.originalname, mimeType: form.value.protocol.mimetype, data };
            return await this.runInTenantOfFiscalYear(
                user,
                TRANSMIT,
                id,
                async () => await this.eBilanzService.recordManualFiling(id, protocol, user.id)
            );
        }
        finally {
            await form.cleanup();
        }
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.file()
    // the path the url of a FileReference names, as the download route of a CrudController has it
    @Get('/:id/files/:file')
    async resolveFilingFile(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @Param.path('file', { type: 'string' })
        file: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<FileResponse> {
        return await this.runInTenantOfRow(
            user,
            READ,
            async () => (await this.filingRepository.findById(id, { acrossTenants: true })).tenantId,
            async () => await CrudControllerFileUtilities.resolveDownload(
                await this.filingRepository.findById(id),
                FilePropertyUtilities.resolveStoredFileProperties(EBilanzFiling),
                file
            )
        );
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.object(EBilanzSettingsView)
    @Get('/settings')
    async findSettings(
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<EBilanzSettingsView> {
        return await this.runInTenant(user, READ, tenantId, async () => this.resolveView(await this.eBilanzService.findSettings()));
    }

    @Auth.hasAnyLevelPermission(MANAGE)
    @Response.object(EBilanzSettingsView)
    @Put('/settings/certificate')
    async updateCertificate(
        @Body(EBilanzCertificateUpload, { type: MimeType.FORM_DATA })
        form: FormData<EBilanzCertificateUpload>,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<EBilanzSettingsView> {
        try {
            const data: Buffer = await buffer(FsUtilities.createReadStream(form.value.certificate.path));
            const certificate: EBilanzFile = { name: form.value.certificate.originalname, mimeType: form.value.certificate.mimetype, data };
            return await this.runInTenant(
                user,
                MANAGE,
                tenantId,
                async () => this.resolveView(await this.eBilanzService.updateCertificate(certificate, form.value.pin, user.id))
            );
        }
        finally {
            await form.cleanup();
        }
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.array(EBilanzAccountMapping)
    @Get('/account-mappings')
    async findAccountMappings(
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<EBilanzAccountMapping[]> {
        return await this.runInTenant(user, READ, tenantId, async () => await this.eBilanzService.findAccountMappings());
    }

    @Auth.hasAnyLevelPermission(MANAGE)
    @Response.object(EBilanzAccountMapping)
    @Put('/account-mappings/:accountId')
    async updateAccountMapping(
        @Param.path('accountId', { type: 'string', format: 'uuid' })
        accountId: string,
        @Body(EBilanzAccountMappingInput)
        input: EBilanzAccountMappingInput,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<EBilanzAccountMapping> {
        return await this.runInTenant(
            user,
            MANAGE,
            tenantId,
            async () => await this.eBilanzService.updateAccountMapping({
                accountId,
                position: input.position,
                creditPosition: input.creditPosition ?? null
            })
        );
    }

    @Auth.hasAnyLevelPermission(MANAGE)
    @Delete('/account-mappings/:accountId')
    async deleteAccountMapping(
        @Param.path('accountId', { type: 'string', format: 'uuid' })
        accountId: string,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<void> {
        await this.runInTenant(user, MANAGE, tenantId, async () => await this.eBilanzService.deleteAccountMapping(accountId));
    }

    /**
     * Resolves what the routes answer of the settings: never the certificate or its PIN.
     * @param settings - The settings, or undefined for none.
     * @returns The view.
     */
    private resolveView(settings: EBilanzSettings | undefined): EBilanzSettingsView {
        return {
            certificateUploadedAt: settings?.certificateUploadedAt ?? null,
            certificateUploadedBy: settings?.certificateUploadedBy ?? null
        };
    }

    /**
     * Runs work in the tenant of the request, or, for a request naming none, in the tenant of the fiscal year, which
     * only the platform permission reaches.
     * @param user - The caller.
     * @param permissions - The permissions of the route.
     * @param fiscalYearId - The id of the fiscal year.
     * @param work - The work.
     * @returns What the work returns.
     */
    private async runInTenantOfFiscalYear<T>(
        user: CurrentUser,
        permissions: AnyLevelPermissions,
        fiscalYearId: string,
        work: () => Promise<T>
    ): Promise<T> {
        return await this.runInTenantOfRow(
            user,
            permissions,
            async () => (await this.fiscalYearRepository.findById(fiscalYearId, { acrossTenants: true })).tenantId,
            work
        );
    }

    /**
     * Runs work in the tenant of the request, or, for a request naming none, in the tenant of a fiscal year or a
     * record of the E-Bilanz, which only the platform permission reaches.
     * @param user - The caller.
     * @param permissions - The permissions of the route.
     * @param resolveTenantId - Resolves the tenant of the row, read across the tenants.
     * @param work - The work.
     * @returns What the work returns.
     */
    private async runInTenantOfRow<T>(
        user: CurrentUser,
        permissions: AnyLevelPermissions,
        resolveTenantId: () => Promise<string>,
        work: () => Promise<T>
    ): Promise<T> {
        if (this.tenantService.getActiveTenantId() != undefined) {
            return await work();
        }
        this.validatePlatformPermission(user, permissions);
        return await this.tenantService.runAs(await resolveTenantId(), work);
    }

    /**
     * Runs work in the tenant of the request, or, for a request naming none, in the tenant it names by `tenantId`,
     * which only the platform permission reaches.
     * @param user - The caller.
     * @param permissions - The permissions of the route.
     * @param tenantId - The tenant a request naming none names.
     * @param work - The work.
     * @returns What the work returns.
     * @throws A BadRequestError for a request naming no tenant and no `tenantId`.
     */
    private async runInTenant<T>(
        user: CurrentUser,
        permissions: AnyLevelPermissions,
        tenantId: string | undefined,
        work: () => Promise<T>
    ): Promise<T> {
        if (this.tenantService.getActiveTenantId() != undefined) {
            return await work();
        }
        this.validatePlatformPermission(user, permissions);
        if (tenantId == undefined) {
            throw new BadRequestError($ts`A request naming no tenant needs to name the tenantId of the books.`);
        }
        return await this.tenantService.runAs(tenantId, work);
    }

    /**
     * Validates that a caller holds the platform permission of a route.
     * @param user - The caller.
     * @param permissions - The permissions of the route.
     * @throws A ForbiddenError when they do not.
     */
    private validatePlatformPermission(user: CurrentUser, permissions: AnyLevelPermissions): void {
        if (!user.platformPermissions.includes(permissions.platformPermission)) {
            throw new ForbiddenError($ts`You do not have permission to access this route.`);
        }
    }
}

// the route the url of the protocol of each record points to, with the access of the route answering the records. It
// writes no record from a multipart body, the protocol of a filing by hand being stored by the service
MetadataUtilities.setRouteServedFiles(
    EBilanzController,
    { entityClass: EBilanzFiling, accessOf: 'resolveState', bodyClasses: [] },
    'resolveFilingFile'
);