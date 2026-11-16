import { createContext, RenderContext, TsxChildren } from 'zibri';

/**
 * The columns of a table: the titles its head cells note as they render, and the column of the next cell of a row.
 */
export type TableColumns = {
    titles: TsxChildren[],
    next: number
};

// what a cell of the body shows above itself on a narrow screen, where each row is a card of its own
export const TableColumnsContext: RenderContext<TableColumns | undefined> = createContext<TableColumns | undefined>(undefined);