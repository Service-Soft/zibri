import { ZibriApplication } from '../../../application/application';
import { DataSourceInterface } from '../../../data-source/data-sources/data-source.interface';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { getRegisteredProvidersOfVariant } from '../../../di/get-registered-providers-of-variant.function';
import { inject } from '../../../di/inject.function';
import { DiProvider } from '../../../di/models/di-provider.model';
import { DiTokenProviderRecord, providersFromTokenRecord } from '../../../di/models/di-token.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { InternalError } from '../../../error-handling/internal-error.model';
import { Newable } from '../../../types/newable.type';
import { Ms } from '../../../utilities/ms';
import { validateEntitiesRegistered } from '../../../utilities/validate-entities-registered.function';
import { validateTokensRegistered } from '../../../utilities/validate-tokens-registered.function';
import { ZibriPlugin } from '../../plugin.model';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../bookkeeping.tokens';
import { type BookkeepingCompany } from '../models/bookkeeping-company.model';
import { BookkeepingSettings } from '../models/bookkeeping-settings.model';
import { EBilanzTaxonomyUtilities } from './e-bilanz-taxonomy.utilities';
import { E_BILANZ_TRANSMITTER_DI_VARIANT, ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS } from './e-bilanz.tokens';
import { EBilanzAccountMapping } from './models/e-bilanz-account-mapping.model';
import { EBilanzFiling } from './models/e-bilanz-filing.model';
import { type EBilanzPluginOptions } from './models/e-bilanz-plugin-options.model';
import { EBilanzSettings } from './models/e-bilanz-settings.model';
import { GermanBookkeepingCompany } from './models/german-bookkeeping-company.model';
import { EBilanzConformanceService } from './services/e-bilanz-conformance.service';
import { EBilanzService } from './services/e-bilanz.service';
import { Hgb6EBilanzTaxonomyAdapter } from './services/hgb-6.e-bilanz-taxonomy-adapter';
import { E_BILANZ_TAXONOMIES } from './taxonomies/e-bilanz-taxonomies.model';

/**
 * The entities the E-Bilanz keeps, in the data source of the books.
 */
const E_BILANZ_ENTITIES: Newable<BaseEntity>[] = [EBilanzSettings, EBilanzAccountMapping, EBilanzFiling];

/**
 * Plugin that states the books of the bookkeeping plugin as the E-Bilanz of § 5b EStG, in the HGB taxonomy of each
 * fiscal year: prepares and validates it, keeps the records of its filing, archived, and the ELSTER certificate it
 * takes, and asks for it once a fiscal year is closed, with `EBilanzConformanceService`. It is sent by a transmitter the
 * application provides, or filed by hand from an export. Needs `ZibriBookkeepingPlugin`, with `GermanBookkeepingCompany`
 * as the company of its settings in `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL`.
 */
export class ZibriEBilanzPlugin extends ZibriPlugin {
    private readonly defaultDiProviders: DiTokenProviderRecord<typeof ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS> = {
        OPTIONS_INPUT: { useValue: {} },
        OPTIONS: {
            useFactory: () => {
                const res: EBilanzPluginOptions = {
                    store: inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS).receiptStore,
                    // a transmitter automating another program takes minutes
                    transmissionTimeoutInMs: 30 * Ms.MINUTE,
                    ...inject(ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.OPTIONS_INPUT)
                };
                return res;
            }
        },
        TAXONOMIES: { useFactory: () => E_BILANZ_TAXONOMIES },
        TAXONOMY_ADAPTERS: { useFactory: () => [inject(Hgb6EBilanzTaxonomyAdapter)] },
        E_BILANZ_SERVICE: { useClass: EBilanzService },
        FILE_STORE: { useFactory: () => inject(ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.OPTIONS).store }
    };

    override providers: DiProvider<unknown>[] = providersFromTokenRecord(ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS, this.defaultDiProviders);

    // eslint-disable-next-line jsdoc/require-jsdoc
    validate(app: ZibriApplication): void {
        validateEntitiesRegistered(this.constructor.name, app, BookkeepingSettings, ...E_BILANZ_ENTITIES);
        validateTokensRegistered(this.constructor.name, ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS);
        // the obligation is asked by the conformance, so an application keeping E-Bilanzen without it would never be
        // asked for one
        const conformances: unknown[] = inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.BOOKKEEPING_CONFORMANCE_SERVICES);
        if (!conformances.some(c => c instanceof EBilanzConformanceService)) {
            throw new InternalError(
                `${this.constructor.name} needs EBilanzConformanceService`
                + ' in ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.BOOKKEEPING_CONFORMANCE_SERVICES, or a class extending it.'
            );
        }
        // the E-Bilanz states the company of the bookkeeping settings, which holds what the GCD module asks of it only
        // when the application registered the German company as their model
        const companyModel: Newable<BookkeepingCompany> = inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL);
        if (companyModel !== GermanBookkeepingCompany && !(companyModel.prototype instanceof GermanBookkeepingCompany)) {
            throw new InternalError(
                `${this.constructor.name} needs GermanBookkeepingCompany, or a class extending it,`
                + ` in ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL, and got ${companyModel.name}.`
            );
        }
        if (getRegisteredProvidersOfVariant(E_BILANZ_TRANSMITTER_DI_VARIANT).length > 1) {
            throw new InternalError(`${this.constructor.name} takes at most one provider of E_BILANZ_TRANSMITTER_DI_VARIANT.`);
        }
        EBilanzTaxonomyUtilities.validateTaxonomies(
            inject(ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.TAXONOMIES),
            inject(ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.TAXONOMY_ADAPTERS)
        );
        const dataSources: Set<DataSourceInterface> = new Set([BookkeepingSettings, ...E_BILANZ_ENTITIES].map(entity => {
            const repository: Repository<BaseEntity> = inject(repositoryTokenFor(entity));
            return repository.dataSource;
        }));
        if (dataSources.size > 1) {
            throw new InternalError(
                `${this.constructor.name} needs ${E_BILANZ_ENTITIES.map(e => e.name).join(', ')} in the data source of the books.`
            );
        }
    }
}