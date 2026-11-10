import { createContext, RenderContext } from 'zibri';

/**
 * The rows of the body of a table, which count themselves as they render.
 */
export type TableRows = {
    // how many rendered so far
    count: number,
    // how many show while the table is collapsed, when it collapses at all
    shown?: number
};

export const TableRowsContext: RenderContext<TableRows | undefined> = createContext<TableRows | undefined>(undefined);