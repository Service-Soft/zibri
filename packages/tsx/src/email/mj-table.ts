import { defineEmailComponent, TsxComponent } from './define-email-component';
import { EmailPaddingProps, resolvePaddingOf } from './dimensions';
import { EmailMarkupUtilities } from './email-markup.utilities';
import { withDefaults } from './with-defaults';

/**
 * Props for {@link MjTable}.
 */
export type MjTableProps = EmailPaddingProps & {
    /**
     * Horizontal alignment within the column. Defaults to `left`.
     */
    align?: 'left' | 'center' | 'right',
    /**
     * The border of the table, as a CSS `border` value. Defaults to `none`.
     */
    border?: string,
    /**
     * The space between a cell's border and its content. Defaults to `0`.
     */
    cellpadding?: number,
    /**
     * The space between cells. Defaults to `0`.
     */
    cellspacing?: number,
    /**
     * Background color of the surrounding cell.
     */
    containerBackgroundColor?: string,
    /**
     * Text color. Defaults to `#000000`.
     */
    color?: string,
    /**
     * Font stack. Defaults to `Ubuntu, Helvetica, Arial, sans-serif`.
     */
    fontFamily?: string,
    /**
     * Font size. Defaults to `13px`.
     */
    fontSize?: string,
    /**
     * Line height. Defaults to `22px`.
     */
    lineHeight?: string,
    /**
     * The role of the table, `presentation` for one that only lays content out.
     */
    role?: 'none' | 'presentation',
    /**
     * The CSS `table-layout`. Defaults to `auto`.
     */
    tableLayout?: 'auto' | 'fixed' | 'initial' | 'inherit',
    /**
     * The width, e.g. `100%`, `300px` or `auto`. Defaults to `100%`.
     */
    width?: string,
    /**
     * A CSS class added to the surrounding cell.
     */
    cssClass?: string
};

/**
 * A data table, whose rows are its children. Mirrors MJML's `mj-table`: a table styled for every client, in one row of
 * the enclosing column.
 */
export const MjTable: TsxComponent<MjTableProps> = defineEmailComponent<MjTableProps>('MjTable', (props, $ssr) => {
    const p: MjTableProps = withDefaults($ssr, 'MjTable', props);
    const width: string = p.width ?? '100%';
    const cellspacing: number = p.cellspacing ?? 0;
    const table: string = `<table${EmailMarkupUtilities.resolveAttributes({
        cellpadding: p.cellpadding ?? 0,
        cellspacing,
        role: p.role,
        // MJML writes a width in pixels as a number, and a percentage or `auto` as it is
        width: width === 'auto' || width.endsWith('%') ? width : Number.parseInt(width, 10),
        border: '0'
    })} style="${EmailMarkupUtilities.resolveStyle({
        color: p.color ?? '#000000',
        'font-family': p.fontFamily ?? 'Ubuntu, Helvetica, Arial, sans-serif',
        'font-size': p.fontSize ?? '13px',
        'line-height': p.lineHeight ?? '22px',
        'table-layout': p.tableLayout ?? 'auto',
        width,
        border: p.border ?? 'none',
        'border-collapse': cellspacing > 0 ? 'separate' : undefined
    })}">${$ssr.child(props.children)}</table>`;

    return $ssr.raw(EmailMarkupUtilities.resolveRow({
        align: p.align ?? 'left',
        cssClass: p.cssClass,
        containerBackgroundColor: p.containerBackgroundColor,
        padding: resolvePaddingOf(p, '10px 25px')
    }, table));
});