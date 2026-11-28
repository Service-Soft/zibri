/**
 * Which balance sheet an E-Bilanz states.
 */
export enum EBilanzAccountingStandard {
    /**
     * The commercial balance sheet, which is the tax balance sheet as well (Einheitsbilanz).
     */
    UNIFIED = 'unified',
    /**
     * A tax balance sheet of its own (Steuerbilanz), from books that state it.
     */
    TAX = 'tax'
}
