import { MdxContentProps, provideContext, TsxChildren, TsxComponent, useContext } from 'zibri';

import { CollapsibleTable } from './collapsible-table';
import { PageSection, PageSectionContext } from './page-section-context';
import { TableColumns, TableColumnsContext } from './table-columns-context';
import { TableRows, TableRowsContext } from './table-rows-context';

// a table of key exports longer than this shows its first rows, until the reader asks for all of them
const COLLAPSES_ABOVE: number = 12;
const SHOWN_ROWS: number = 8;

// scrolls on its own when wider than the page, inside the border, whose corners also round the head. On a narrow
// screen each row is a card instead
export const Table: TsxComponent<MdxContentProps> = props => {
    const section: PageSection | undefined = useContext(PageSectionContext);
    const rows: TableRows = { count: 0, shown: section?.id === 'key-exports' ? SHOWN_ROWS : undefined };
    const columns: TableColumns = { titles: [], next: 0 };
    provideContext(TableRowsContext, rows);
    provideContext(TableColumnsContext, columns);
    // read only now, as the rows count themselves while they render, and then the table knows whether it collapses
    const content: TsxChildren = props.children;
    if (rows.shown !== undefined && rows.count > COLLAPSES_ABOVE) {
        return <CollapsibleTable rows={rows.count} shown={rows.shown}>{content}</CollapsibleTable>;
    }
    return (
        <div className="my-4 overflow-x-auto rounded-md border border-primary">
            <table
                id={rows.shown === undefined ? undefined : 'key-exports-table'}
                className="w-full border-collapse text-white max-sm:block"
            >
                {content}
            </table>
        </div>
    );
};