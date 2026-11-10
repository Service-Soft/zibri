import { MdxTableRowProps, TsxChildren, TsxComponent, useContext } from 'zibri';

import { TableColumns, TableColumnsContext } from './table-columns-context';
import { TableRows, TableRowsContext } from './table-rows-context';

// a card of its own on a narrow screen. A row past those a collapsed table shows hides while it is collapsed
export const TableRow: TsxComponent<MdxTableRowProps> = props => {
    const rows: TableRows | undefined = useContext(TableRowsContext);
    const columns: TableColumns | undefined = useContext(TableColumnsContext);
    if (columns !== undefined) {
        columns.next = 0;
    }
    // read only now, as its cells count their columns from the first
    const children: TsxChildren = props.children;
    if (props.head || rows === undefined) {
        return <tr className="font-semibold">{children}</tr>;
    }
    const index: number = rows.count++;
    const hides: boolean = rows.shown !== undefined && index >= rows.shown;
    const hiding: string = hides ? 'group-data-[state=collapsed]:hidden' : '';
    return <tr className={`even:bg-primary/20 max-sm:block max-sm:pb-2 ${hiding}`}>{children}</tr>;
};