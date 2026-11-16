import { MdxTableCellProps, TsxChildren, TsxComponent, useContext } from 'zibri';

import { TableColumns, TableColumnsContext } from './table-columns-context';

type CellAlignment = NonNullable<MdxTableCellProps['align']>;

// a class for the alignment, as the content security policy of the pages refuses a style attribute
const ALIGN_CLASSES: Record<CellAlignment, string> = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right'
};

// on a narrow screen a row is a card: its first cell the title, every other one below the title of its column
export const TableCell: TsxComponent<MdxTableCellProps> = ({ head, align = 'left', children }) => {
    const columns: TableColumns | undefined = useContext(TableColumnsContext);
    const className: string = `px-3 py-2 ${ALIGN_CLASSES[align]}`;
    if (head) {
        columns?.titles.push(children);
        return <th className={className}>{children}</th>;
    }
    const column: number = columns === undefined ? 0 : columns.next++;
    const title: TsxChildren | undefined = column === 0 ? undefined : columns?.titles[column];
    return (
        <td className={`${className} max-sm:block max-sm:py-1 max-sm:text-left ${column === 0 ? 'max-sm:pt-3 max-sm:font-semibold' : ''}`}>
            {title !== undefined && <span className="block sm:hidden text-xs uppercase tracking-wider text-secondary">{title}</span>}
            {children}
        </td>
    );
};