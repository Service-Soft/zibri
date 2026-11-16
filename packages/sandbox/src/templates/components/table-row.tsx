import { MdxTableRowProps, TsxChildren, TsxComponent, useContext } from 'zibri';

import { TableColumns, TableColumnsContext } from './table-columns-context';

// every other row tinted, so a long row reads across, and a card of its own on a narrow screen
export const TableRow: TsxComponent<MdxTableRowProps> = props => {
    const columns: TableColumns | undefined = useContext(TableColumnsContext);
    if (columns !== undefined) {
        columns.next = 0;
    }
    // read only now, as its cells count their columns from the first
    const children: TsxChildren = props.children;
    return <tr className={props.head ? 'font-semibold' : 'even:bg-primary/20 max-sm:block max-sm:pb-2'}>{children}</tr>;
};