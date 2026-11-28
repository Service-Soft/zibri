import { type OmitStrict } from '../../../../types/omit-strict.type';
import { type EBilanzTaxonomyPositionRow } from './e-bilanz-taxonomy-position-row.type';
import { type EBilanzStatementName } from './e-bilanz-taxonomy-statements.model';
import { type EBilanzTaxonomy } from './e-bilanz-taxonomy.model';

/**
 * What a version of the taxonomy changes of a statement of the version before it: the positions it removes, and each
 * position it adds or changes, after the position named or at the start for null.
 */
export type EBilanzTaxonomyStatementChange = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly removed: readonly string[],
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly rows: readonly { readonly after: string | null, readonly row: EBilanzTaxonomyPositionRow }[]
};

/**
 * A version of the taxonomy stated as what it changes of the version before it, which
 * `EBilanzTaxonomyUtilities.resolveChanged` resolves it from.
 */
export type EBilanzTaxonomyChange = OmitStrict<EBilanzTaxonomy, 'statements'> & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly statements: Readonly<Record<EBilanzStatementName, EBilanzTaxonomyStatementChange>>
};
