import { type EBilanzFixedAssetValueModel } from './e-bilanz-fixed-asset-value.model';

/**
 * A position of the fixed assets in the statement of changes in fixed assets (Anlagenspiegel) of an E-Bilanz.
 */
export type EBilanzFixedAssetModel = {
    /**
     * The element name of the position.
     */
    position: string,
    /**
     * The German label of the position.
     */
    label: string,
    /**
     * The position of the row it is summed into, or null for the row of the fixed assets themselves.
     */
    parent: string | null,
    /**
     * The value of each column.
     */
    values: EBilanzFixedAssetValueModel[]
};