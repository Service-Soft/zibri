import { Input, Ref, Refs, State, TsxChildren, TsxElement, useEffect, useInput, useRef, useRefs, useState, useWritableInput } from '../index';

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
 * Refs, typed by the element they are put on and by whether they need one.
 * @returns The rendered element.
 */
function refs(): TsxElement {
    const dialog: Ref<HTMLDialogElement> = useRef<HTMLDialogElement>();
    const anyElement: Ref<HTMLElement> = useRef<HTMLElement>();
    const block: Ref<HTMLDivElement> = useRef<HTMLDivElement>();
    const hint: Ref<HTMLElement | undefined> = useRef<HTMLElement>({ required: false });
    const rows: Refs<HTMLLIElement> = useRefs<HTMLLIElement>();
    const input: Ref<HTMLInputElement> = useRef<HTMLInputElement>({ required: true });

    const shown: HTMLDialogElement = dialog.current;
    const maybe: HTMLElement | undefined = hint.current;
    const all: HTMLLIElement[] = rows.current;
    // @ts-expect-error a ref that is not required may hold no element
    const certain: HTMLElement = hint.current;
    // @ts-expect-error useRef takes whether the ref is required, and nothing else
    useRef<HTMLElement>(0);
    void [shown, maybe, all, certain];

    return <div ref={block}>
        <dialog ref={dialog}/>
        <dialog ref={anyElement}/>
        <em ref={hint}/>
        <ul><li ref={rows}/></ul>
        {/* @ts-expect-error a ref of an input does not fit a dialog */}
        <dialog ref={input}/>
        {/* @ts-expect-error a ref is a ref, not any object */}
        <p ref={{}}/>
    </div>;
}

/**
 * Effects, typed by what they run again for and what they return.
 * @returns The rendered element.
 */
function effects(): TsxElement {
    const count: State<number> = useState(0);
    /**
     * Whether the count has more than one digit, a function an effect runs again for.
     * @returns True above 9.
     */
    function isBig(): boolean {
        return count.value > 9;
    }

    useEffect(() => report(String(count.value)), [count, isBig]);
    useEffect(async () => {
        await Promise.resolve();
    }, [count]);
    useEffect(() => {
        const timer: ReturnType<typeof setInterval> = setInterval(() => report('tick'), 1000);
        return () => clearInterval(timer);
    }, [count]);
    // @ts-expect-error an effect runs again for at least one state or function, and onClient runs once
    useEffect(() => report('once'), []);
    // @ts-expect-error the value of a state is what it holds now, and an effect follows the state itself
    useEffect(() => report('read'), [count.value]);
    // @ts-expect-error an effect returns nothing, or a cleanup
    useEffect(() => 'done', [count]);

    return <p>{count.value}</p>;
}

/**
 * Shows a text it is handed.
 * @param props - The props.
 * @param props.text - The text.
 * @returns The rendered element.
 */
function Preview({ text }: {
    /**
     * The text.
     */
    text: string
}): TsxElement {
    const shown: Input<string> = useInput(text);
    return <p>{shown.value}</p>;
}

/**
 * Edits a state it is handed.
 * @param props - The props.
 * @param props.value - The state.
 * @returns The rendered element.
 */
function Field({ value }: {
    /**
     * The state.
     */
    value: State<string>
}): TsxElement {
    const text: State<string> = useWritableInput(value);
    return <input value={text.value}/>;
}

/**
 * Inputs, typed by whether the component may write them.
 * @returns The rendered element.
 */
function inputs(): TsxElement {
    const email: State<string> = useState('');
    const tags: Input<string[]> = useInput(['admin']);
    const first: string | undefined = tags.value[0];
    // @ts-expect-error the handle useInput returns is read only
    tags.value = [];
    // @ts-expect-error what useInput holds is read only as well
    tags.value[0] = 'owner';
    void first;

    return <div>
        <Preview text={email.value}/>
        <Field value={email}/>
        {/* @ts-expect-error a state is not the value it holds */}
        <Preview text={email}/>
        {/* @ts-expect-error a value is not the state holding it */}
        <Field value={email.value}/>
    </div>;
}

/**
 * Form controls, bound one way by a value and both ways by a state.
 * @returns The rendered element.
 */
function forms(): TsxElement {
    const email: State<string> = useState('');
    const agreed: State<boolean> = useState(false);
    const count: State<number> = useState(0);

    return <form>
        <input value={email}/>
        <input value={email.value}/>
        <input type="checkbox" checked={agreed}/>
        <textarea value={email}/>
        <select value={email}/>
        {/* @ts-expect-error a control holds text, which a state of a number is not */}
        <input value={count}/>
        {/* @ts-expect-error a checkbox is checked by a state of a boolean */}
        <input type="checkbox" checked={email}/>
        {/* @ts-expect-error a button is sent with its value, and writes no state */}
        <button value={email}/>
    </form>;
}

/**
 * Stands in for whatever a handler would do with a value.
 * @param value - The reported value.
 */
function report(value: string): void {
    void value;
}

// eslint-disable-next-line jsdoc/require-jsdoc
export { Card, effects, elementSpecific, forms, globals, handlers, inputs, refs, rejected, structures };