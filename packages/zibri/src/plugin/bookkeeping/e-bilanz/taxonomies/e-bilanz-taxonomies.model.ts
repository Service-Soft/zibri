import { type EBilanzTaxonomy } from '../models/e-bilanz-taxonomy.model';
import { HGB_TAXONOMY_6_10 } from './hgb-taxonomy-6-10.model';
import { HGB_TAXONOMY_6_9 } from './hgb-taxonomy-6-9.model';

/**
 * The versions of the HGB taxonomy shipped: 6.9, for the fiscal years from 2026 and allowed for 2025 (BMF of
 * 10.06.2025), and 6.10, for the fiscal years from 2027 and allowed for 2026 (BMF of 08.06.2026). What
 * `ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.TAXONOMIES` holds by default.
 */
export const E_BILANZ_TAXONOMIES: readonly EBilanzTaxonomy[] = [HGB_TAXONOMY_6_9, HGB_TAXONOMY_6_10];