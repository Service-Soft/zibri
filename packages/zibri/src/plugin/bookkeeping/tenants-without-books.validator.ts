import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { OnAppStart } from '../../global/on-app-start.interface';
import { type BaseTenantDefinition } from '../../tenancy/tenant-definition/base-tenant-definition.model';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from './bookkeeping.tokens';
import { type BookkeepingPluginOptions } from './models/bookkeeping-plugin-options.model';
import { BookkeepingSettings } from './models/bookkeeping-settings.model';

/**
 * Refuses to start an application whose `tenantsWithoutBooks` is `never` while a tenant that is not deactivated has
 * no bookkeeping settings, such as one created before the application kept books.
 */
// on start rather than on init, where the migrations ran already as well: a command initializes the application
// without starting it, so that one creating the missing settings still runs
@Injectable({ register: 'onUse' })
export class TenantsWithoutBooksValidator implements OnAppStart {
    constructor(
        @Inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS)
        private readonly options: BookkeepingPluginOptions
    ) {}

    /**
     * Validates that every tenant keeps books, with `never`.
     * @throws An InternalError naming every tenant that is not deactivated and has no bookkeeping settings.
     */
    async onAppStart(): Promise<void> {
        if (this.options.tenantsWithoutBooks !== 'never') {
            return;
        }
        const tenantService: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        // there is one with never, which ZibriBookkeepingPlugin.validate refuses to start without
        const tenantEntity: Newable<BaseTenantDefinition> | undefined = tenantService.findTenantEntityClass?.();
        if (tenantEntity == undefined) {
            return;
        }
        const tenants: Repository<BaseTenantDefinition> = inject(repositoryTokenFor(tenantEntity));
        const settings: Repository<BookkeepingSettings> = inject(repositoryTokenFor(BookkeepingSettings));
        const keepingBooks: Set<string> = new Set(
            (await settings.findAll({ select: ['tenantId'], acrossTenants: true, limit: 'all' })).map(s => s.tenantId)
        );
        const withoutBooks: string[] = [];
        for (const { id } of await tenants.findAll({ select: ['id'], limit: 'all' })) {
            if (!keepingBooks.has(id) && !(await tenantService.resolveIsDeactivated?.(id) ?? false)) {
                withoutBooks.push(id);
            }
        }
        if (withoutBooks.length) {
            throw new InternalError(
                `The tenants ${withoutBooks.join(', ')} have no bookkeeping settings, which tenantsWithoutBooks set to `
                + 'never needs every tenant that is not deactivated to have before the application starts.'
            );
        }
    }
}
