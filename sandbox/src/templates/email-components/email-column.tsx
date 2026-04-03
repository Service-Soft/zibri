import { ComponentChildren } from 'preact';
import { PreactEmailComponent } from 'zibri';

import { useEmailContext } from './email-context';

type Props = {
    children: ComponentChildren,
    width?: string,
    verticalAlign?: 'top' | 'middle' | 'bottom',
    padding?: string,
    paddingTop?: string,
    paddingRight?: string,
    paddingBottom?: string,
    paddingLeft?: string,
    border?: string,
    borderBottom?: string,
    borderLeft?: string,
    borderRight?: string,
    borderTop?: string,
    borderRadius?: string,
    innerBorder?: string,
    innerBorderBottom?: string,
    innerBorderLeft?: string,
    innerBorderRight?: string,
    innerBorderTop?: string,
    innerBorderRadius?: string,
    innerBackgroundColor?: string,
    backgroundColor?: string,
    cssClass?: string
};

export const EmailColumn: PreactEmailComponent<Props> = ({
    children,
    width = '100%',
    verticalAlign = 'top',
    padding = '0px',
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    border = 'none',
    borderBottom,
    borderLeft,
    borderRight,
    borderTop,
    borderRadius,
    innerBorder = 'none',
    innerBorderBottom,
    innerBorderLeft,
    innerBorderRight,
    innerBorderTop,
    innerBorderRadius,
    innerBackgroundColor,
    backgroundColor,
    cssClass = ''
}) => {
    const { width: sectionWidth, dir, textAlign } = useEmailContext();

    // Resolve pixel width for MSO from section width and column width
    const sectionWidthNum: number = Number.parseInt(sectionWidth);
    const columnWidthNum: number | undefined = width.endsWith('%')
        ? Number.isNaN(sectionWidthNum)
            ? undefined
            : Math.round(sectionWidthNum * (Number.parseFloat(width) / 100))
        : Number.isNaN(Number.parseInt(width))
            ? undefined
            : Number.parseInt(width);

    const resolvedPadding: string = [
        paddingTop ?? padding.split(' ')[0],
        paddingRight ?? padding.split(' ')[1] ?? padding.split(' ')[0],
        paddingBottom ?? padding.split(' ')[2] ?? padding.split(' ')[0],
        paddingLeft ?? padding.split(' ')[3] ?? padding.split(' ')[1] ?? padding.split(' ')[0]
    ].join(' ');

    const borderStyle: string = [
        border !== 'none' ? `border:${border}` : '',
        borderTop ? `border-top:${borderTop}` : '',
        borderRight ? `border-right:${borderRight}` : '',
        borderBottom ? `border-bottom:${borderBottom}` : '',
        borderLeft ? `border-left:${borderLeft}` : '',
        borderRadius ? `border-radius:${borderRadius}` : ''
    ].filter(Boolean).join('; ');

    const innerBorderStyle: string = [
        innerBorder !== 'none' ? `border:${innerBorder}` : '',
        innerBorderTop ? `border-top:${innerBorderTop}` : '',
        innerBorderRight ? `border-right:${innerBorderRight}` : '',
        innerBorderBottom ? `border-bottom:${innerBorderBottom}` : '',
        innerBorderLeft ? `border-left:${innerBorderLeft}` : '',
        innerBorderRadius ? `border-radius:${innerBorderRadius}` : ''
    ].filter(Boolean).join('; ');

    const outerTdStyle: string = [
        'font-size:0px',
        `padding:${resolvedPadding}`,
        `text-align:${textAlign}`,
        `vertical-align:${verticalAlign}`,
        borderStyle
    ].filter(Boolean).join('; ');

    const containerStyle: string = [
        backgroundColor ? `background-color:${backgroundColor}` : '',
        borderStyle,
        `vertical-align:${verticalAlign}`
    ].filter(Boolean).join('; ');

    const innerTableStyle: string = [
        innerBackgroundColor ? `background-color:${innerBackgroundColor}` : '',
        innerBorderStyle
    ].filter(Boolean).join('; ');

    const msoWidth: string = columnWidthNum !== undefined ? `${columnWidthNum}px` : width;
    const msoWidthAttr: string = columnWidthNum !== undefined ? ` width="${columnWidthNum}"` : '';

    return <>
        {`<!--[if mso | IE]><td class="${cssClass}" style="vertical-align:${verticalAlign};width:${msoWidth};"${msoWidthAttr}><![endif]-->`}
        <div
            class={['outlook-group-fix', cssClass].filter(Boolean).join(' ')}
            style={[
                `direction:${dir}`,
                'display:inline-block',
                'font-size:0px',
                `text-align:${textAlign}`,
                `vertical-align:${verticalAlign}`,
                `width:${width}`,
                containerStyle
            ].filter(Boolean).join('; ')}
        >
            <table
                cellPadding="0"
                cellSpacing="0"
                role="presentation"
                style={['width:100%', innerTableStyle].filter(Boolean).join('; ')}
            >
                <tbody>
                    <tr>
                        <td style={outerTdStyle}>
                            {children}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        {'<!--[if mso | IE]></td><![endif]-->'}
    </>;
};