import { $ts, MdxHeading, Ref, TsxComponent, useRef } from 'zibri';

import { DocsOnThisPage } from './docs-on-this-page';

type DocsOnThisPageButtonProps = {
    headings: MdxHeading[]
};

// the sections of the page behind a button at the bottom right, where the screen has no room for them beside the page.
// A click outside or Escape closes them as a popover, and a click on a section does too, as the page stays
export const DocsOnThisPageButton: TsxComponent<DocsOnThisPageButtonProps> = ({ headings }) => {
    const panel: Ref<HTMLDivElement> = useRef<HTMLDivElement>();
    return (
        <>
            <button
                id="docs-on-this-page-button"
                popovertarget="docs-on-this-page-panel"
                aria-label={$ts`On this page`}
                className="xl:hidden fixed bottom-6 right-6 z-10 flex flex-col items-start justify-center gap-1 w-12 h-12 pl-3.5
                    rounded-full bg-primary border border-secondary shadow-elevation cursor-pointer hover:bg-secondary"
            >
                <span className="block w-5 h-0.5 bg-white"></span>
                <span className="block w-4 h-0.5 ml-1 bg-white"></span>
                <span className="block w-4 h-0.5 ml-1 bg-white"></span>
            </button>
            <div
                id="docs-on-this-page-panel"
                popover="auto"
                ref={panel}
                onClick={() => panel.current.hidePopover()}
                className="inset-auto right-6 bottom-22 m-0 w-72 max-h-[70vh] overflow-y-auto p-4 rounded-md border
                    border-primary bg-dark-gray text-white shadow-elevation"
            >
                <DocsOnThisPage headings={headings}/>
            </div>
        </>
    );
};