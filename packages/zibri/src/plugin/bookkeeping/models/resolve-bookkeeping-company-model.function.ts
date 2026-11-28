import { DiContainer } from '../../../di/di-container';
import { inject } from '../../../di/inject.function';
import { type Newable } from '../../../types/newable.type';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../bookkeeping.tokens';
import { BookkeepingCompany } from './bookkeeping-company.model';

/**
 * Resolves the class of the company of the bookkeeping settings, the one registered in
 * `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL`, which the `company` of the settings is validated, described
 * and stored by. `BookkeepingCompany` outside an application keeping books.
 * @returns The class.
 */
export function resolveBookkeepingCompanyModel(): Newable<BookkeepingCompany> {
    // read whenever a value of the settings is, which is after the application registered its providers: parsing,
    // validating and storing a body, and describing the routes, all happen while it runs. A process without the
    // bookkeeping plugin, such as a test of a model alone, has none registered and gets the generic company
    return DiContainer.getInstance().isRegistered(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL)
        ? inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL)
        : BookkeepingCompany;
}
