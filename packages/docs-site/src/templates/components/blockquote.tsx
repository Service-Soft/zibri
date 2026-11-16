import { MdxAlert, MdxBlockquoteProps, TsxComponent } from 'zibri';

type AlertLook = {
    title: string,
    classes: string
};

const LIMIT_CLASSES: string = 'border-secondary text-secondary';
const HARM_CLASSES: string = 'border-warning text-warning';

// what can hurt the reader stands out from a limit
const ALERT_LOOKS: Record<MdxAlert, AlertLook> = {
    note: { title: 'Note', classes: LIMIT_CLASSES },
    tip: { title: 'Tip', classes: LIMIT_CLASSES },
    important: { title: 'Important', classes: LIMIT_CLASSES },
    warning: { title: 'Warning', classes: HARM_CLASSES },
    caution: { title: 'Caution', classes: HARM_CLASSES }
};

export const Blockquote: TsxComponent<MdxBlockquoteProps> = ({ alert, children }) => {
    if (alert === undefined) {
        return <blockquote className="my-4 pl-4 border-l-4 border-secondary italic">{children}</blockquote>;
    }
    const look: AlertLook = ALERT_LOOKS[alert];
    return (
        <blockquote className={`my-6 px-4 py-1 rounded-sm border-l-4 bg-dark-gray ${look.classes}`}>
            <p className="mt-3 font-semibold tracking-wider">{look.title}</p>
            <div className="text-white">{children}</div>
        </blockquote>
    );
};