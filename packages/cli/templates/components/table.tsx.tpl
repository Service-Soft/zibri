import { MdxContentProps, provideContext, TsxChildren, TsxComponent } from 'zibri';

import { TableColumns, TableColumnsContext } from './table-columns-context';

// scrolls on its own when wider than the page, inside the border, whose corners also round the head. On a narrow
// screen each row is a card instead
export const Table: TsxComponent<MdxContentProps> = props => {
    const columns: TableColumns = { titles: [], next: 0 };
    provideContext(TableColumnsContext, columns);
    // read only now, as its cells note the titles of the columns in what it provides
    const content: TsxChildren = props.children;
    return (
        <div className="my-4 overflow-x-auto rounded-md border border-primary">
            <table className="w-full border-collapse text-white max-sm:block">{content}</table>
        </div>
    );
};