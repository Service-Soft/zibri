import { TsxChildren, TsxElement } from '../index';

/**
 * Type level verification of the jsx typings. Nothing here is executed — it fails the typecheck when
 * the intrinsic element or attribute types regress, which is the only way to test them.
 */

/**
 * Props of the {@link Card} component.
 */
type CardProps = {
    /**
     * The heading of the card.
     */
    title: string,
    /**
     * Whether the card is highlighted.
     */
    highlighted?: boolean,
    /**
     * The content of the card.
     */
    children?: TsxChildren
};

/**
 * A component taking props and children.
 * @param props - The card props.
 * @param props.title - The heading of the card.
 * @param props.highlighted - Whether the card is highlighted.
 * @param props.children - The content of the card.
 * @returns The rendered card.
 */
function Card({ title, highlighted, children }: CardProps): TsxElement {
    return <div className={highlighted === true ? 'card active' : 'card'} data-title={title}>
        <h3>{title}</h3>
        {children}
    </div>;
}

/**
 * Global attributes, a style object, data and aria attributes.
 * @returns The rendered element.
 */
function globals(): TsxElement {
    return <section
        id="main"
        class="wrapper"
        style={{ backgroundColor: 'red', paddingTop: 4, '--brand': '#fff' }}
        title="a section"
        role="region"
        hidden={false}
        tabIndex={-1}
        data-tab-panel="one"
        aria-roledescription="panel"
    >
        <p style="margin:0">text</p>
    </section>;
}

/**
 * Element specific attributes.
 * @returns The rendered element.
 */
function elementSpecific(): TsxElement {
    return <div>
        <a href="/home" target="_blank" rel="noreferrer">home</a>
        <img src="/logo.png" alt="logo" width={64} height={64} loading="lazy"/>
        <input type="checkbox" checked disabled name="agree"/>
        <label for="agree">agree</label>
        <table width="100%" cellpadding={0} role="presentation">
            <tbody>
                <tr>
                    <td colspan={2} valign="top" bgcolor="#ffffff">cell</td>
                </tr>
            </tbody>
        </table>
        <canvas id="chart" width={300} height={150}></canvas>
        <details open>
            <summary>more</summary>
        </details>
        <hr/>
        <br/>
    </div>;
}

/**
 * Event handlers, including a narrowed `currentTarget`.
 * @returns The rendered element.
 */
function handlers(): TsxElement {
    return <form onSubmit={ev => {
        ev.preventDefault();
    }}>
        <textarea rows={4} onChange={ev => {
            // Proves currentTarget is typed as the textarea and not as a bare EventTarget.
            const value: string = ev.currentTarget.value;
            report(value);
        }}/>
        <input onInput={ev => report(ev.currentTarget.value)}/>
        <select onChange={ev => report(ev.currentTarget.value)}>
            <option value="a" selected>a</option>
        </select>
        <button type="submit" onClick={() => report('clicked')}>send</button>
    </form>;
}

/**
 * Fragments, loops, conditionals and raw html.
 * @param items - The items to list.
 * @returns The rendered element.
 */
function structures(items: string[]): TsxElement {
    return <>
        <ul>
            {items.map(item => <li key={item}>{item}</li>)}
        </ul>
        {items.length > 0 && <p>{items.length} items</p>}
        {items.length === 0 ? <p>empty</p> : undefined}
        <div dangerouslySetInnerHTML={{ __html: '<b>trusted</b>' }}/>
        <Card title="nested" highlighted>
            <span>child</span>
        </Card>
    </>;
}

/**
 * Cases that have to stay compile errors.
 * @returns The rendered element.
 */
function rejected(): TsxElement {
    return <div>
        {/* @ts-expect-error a misspelled tag is not a known intrinsic element */}
        <dvi/>
        {/* @ts-expect-error tabIndex takes a number */}
        <span tabIndex="1"/>
        {/* @ts-expect-error colspan is only valid on table cells */}
        <span colspan={2}/>
        {/* @ts-expect-error href is only valid on links */}
        <div href="/home"/>
        {/* @ts-expect-error the title prop of Card is required */}
        <Card/>
        {/* @ts-expect-error highlighted takes a boolean */}
        <Card title="x" highlighted="yes"/>
    </div>;
}

/**
 * Stands in for whatever a handler would do with a value.
 * @param value - The reported value.
 */
function report(value: string): void {
    void value;
}

// eslint-disable-next-line jsdoc/require-jsdoc
export { Card, elementSpecific, globals, handlers, rejected, structures };