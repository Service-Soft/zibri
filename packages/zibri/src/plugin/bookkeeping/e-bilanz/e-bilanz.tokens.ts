/* eslint-disable jsdoc/require-jsdoc */
import { TokenRecord } from '../../../di/models/di-token.model';
import { DiVariant } from '../../../di/models/di-variant.model';
import { InjectionToken } from '../../../di/models/injection-token.model';
import { type EBilanzPluginOptions } from './models/e-bilanz-plugin-options.model';
import { type EBilanzTaxonomy } from './models/e-bilanz-taxonomy.model';
import { type EBilanzServiceInterface } from './services/e-bilanz-service.interface';
import { type EBilanzTaxonomyAdapterInterface } from './services/e-bilanz-taxonomy-adapter.interface';

/**
 * The dependency injection tokens used by the ZibriEBilanzPlugin.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS = {
    OPTIONS_INPUT: eBilanzToken<Partial<EBilanzPluginOptions>>('zi.e_bilanz.options_input'),
    OPTIONS: eBilanzToken<EBilanzPluginOptions>('zi.e_bilanz.options'),
    // the versions of the taxonomy, 6.9 and 6.10 by default: a version published after a release is added here
    TAXONOMIES: eBilanzToken<readonly EBilanzTaxonomy[]>('zi.e_bilanz.taxonomies'),
    // the adapters each version names, that of the versions 6.x by default
    TAXONOMY_ADAPTERS: eBilanzToken<readonly EBilanzTaxonomyAdapterInterface[]>('zi.e_bilanz.taxonomy_adapters'),
    E_BILANZ_SERVICE: eBilanzToken<EBilanzServiceInterface>('zi.e_bilanz.service'),
    // the name of the store of the certificates and the protocols, read by EBilanzSettings.certificate and
    // EBilanzFiling.protocol, which name their store by a token
    FILE_STORE: eBilanzToken<string>('zi.e_bilanz.file_store')
} as const satisfies TokenRecord;

/**
 * The variant of the provider of the transmitter of the E-Bilanz, which sends it to the tax administration. None is
 * registered for you, and at most one is.
 */
export const E_BILANZ_TRANSMITTER_DI_VARIANT: DiVariant = new DiVariant('e-bilanz-transmitter');

/**
 * The variant of the providers of the exporters of the E-Bilanz, each writing it in a format of its own to be filed by
 * hand. None is registered for you.
 */
export const E_BILANZ_EXPORTER_DI_VARIANT: DiVariant = new DiVariant('e-bilanz-exporter');

function eBilanzToken<T = never>(k: `zi.e_bilanz.${string}`): InjectionToken<T> {
    return new InjectionToken<T>(k);
}
