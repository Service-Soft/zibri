import { ConflictError } from '../../../../error-handling/errors/conflict.error';
import { $ts } from '../../../../localization/translate.function';
import { type BookkeepingLegalForm } from '../../models/bookkeeping-legal-form.model';
import { type BookkeepingSettings } from '../../models/bookkeeping-settings.model';
import { type FiscalYear } from '../../models/fiscal-year.model';
import { type BookkeepingConformanceServiceInterface } from './bookkeeping-conformance-service.interface';

/**
 * Which conformances apply to a fiscal year: those it names, or else those of the legal form of the tenant at its end.
 */
export abstract class BookkeepingConformanceUtilities {
    /**
     * Resolves the conformances that apply to a fiscal year: those it names, or else those that apply to the legal
     * form the tenant has at its end.
     * @param services - The conformance services registered.
     * @param settings - The settings of the books.
     * @param fiscalYear - The fiscal year.
     * @returns The conformance services, in the order they are registered.
     * @throws A ConflictError for a conformance the fiscal year names that is not registered.
     */
    static resolveConformances(
        services: BookkeepingConformanceServiceInterface[],
        settings: BookkeepingSettings,
        fiscalYear: FiscalYear
    ): BookkeepingConformanceServiceInterface[] {
        if (fiscalYear.conformances != undefined) {
            this.validateConformanceNames(services, fiscalYear.conformances);
            const names: string[] = fiscalYear.conformances;
            return services.filter(service => names.includes(service.name));
        }
        const legalForm: string | undefined = this.findLegalForm(settings, fiscalYear.end);
        return legalForm == undefined ? [] : services.filter(service => service.isApplicable(legalForm));
    }

    /**
     * Validates that conformances are registered.
     * @param services - The conformance services registered.
     * @param names - The names of the conformances.
     * @throws A ConflictError naming the first one that is not.
     */
    static validateConformanceNames(services: BookkeepingConformanceServiceInterface[], names: string[]): void {
        const registered: string[] = services.map(service => service.name);
        const unknown: string | undefined = names.find(name => !registered.includes(name));
        if (unknown != undefined) {
            throw new ConflictError(
                // eslint-disable-next-line stylistic/max-len -- one template, since it is the key of its translation
                $ts`The conformance "${unknown}" needs to be registered in ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.BOOKKEEPING_CONFORMANCE_SERVICES.`
            );
        }
    }

    /**
     * Finds the legal form the tenant has on a day: the latest of its history valid from that day or before.
     * @param settings - The settings of the books.
     * @param day - The day.
     * @returns The legal form, or undefined for a tenant of none then.
     */
    static findLegalForm(settings: BookkeepingSettings, day: Date): string | undefined {
        return this.sortLegalForms(settings.legalForms)
            .filter(form => form.validFrom.getTime() <= day.getTime())
            .at(-1)
            ?.legalForm;
    }

    /**
     * Sorts the history of a legal form, the earliest first.
     * @param legalForms - The history.
     * @returns A sorted copy.
     */
    static sortLegalForms(legalForms: BookkeepingLegalForm[]): BookkeepingLegalForm[] {
        return [...legalForms].sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
    }
}