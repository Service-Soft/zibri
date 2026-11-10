import { Ref, State, TsxChildren, TsxComponent, useRef, useState } from 'zibri';

type CollapsibleTableProps = {
    // how many rows its body has
    rows: number,
    // how many of them show while it is collapsed
    shown: number,
    children: TsxChildren
};

// a long table of key exports: its first rows, and a button below them that shows the rest. Every row is in the page,
// hidden by a class, so whoever reads its html, such as an assistant, gets them all
export const CollapsibleTable: TsxComponent<CollapsibleTableProps> = ({ rows, shown, children }) => {
    const expanded: State<boolean> = useState(false);
    const toggle: Ref<HTMLButtonElement> = useRef<HTMLButtonElement>();
    return (
        <div
            data-state={expanded.value ? 'expanded' : 'collapsed'}
            className="group my-4 overflow-hidden rounded-md border border-primary"
        >
            <div className="overflow-x-auto">
                <table id="key-exports-table" className="w-full border-collapse text-white max-sm:block">{children}</table>
            </div>
            <button
                ref={toggle}
                id="key-exports-toggle"
                type="button"
                aria-controls="key-exports-table"
                aria-expanded={expanded.value ? 'true' : 'false'}
                className="block w-full px-3 py-2 border-t border-primary text-sm text-secondary cursor-pointer hover:bg-primary"
                onClick={() => {
                    expanded.value = !expanded.value;
                    // the rows above it are gone, so the button is brought back to where the reader looks
                    if (!expanded.value) {
                        toggle.current.scrollIntoView({ block: 'nearest' });
                    }
                }}
            >
                {expanded.value ? `Show the first ${shown}` : `Show all ${rows} exports`}
            </button>
        </div>
    );
};