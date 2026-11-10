import { $ts, DocsUtilities, MdxHeading, TsxChildren, TsxComponent } from 'zibri';

import { DocsOnThisPage } from './docs-on-this-page';
import { DocsOnThisPageButton } from './docs-on-this-page-button';
import { DocsSearchBox } from './docs-search-box';
import { DocsSidebar } from './docs-sidebar';
import { DOCS_SITE } from './docs-site';
import { BasePage } from '../components/base-page';

type DocsLayoutProps = {
    title: string,
    // the file of the page, which the sidebar marks
    file: string,
    headings: MdxHeading[],
    children: TsxChildren
};

// a page of the documentation below the navbar of the application: a bar with the search that stays at the top, the
// pages beside the content, and the sections of the page beside it on a wide screen. On a narrow one the pages are
// behind a button of the bar, and the sections behind one at the bottom right
export const DocsLayout: TsxComponent<DocsLayoutProps> = ({ title, file, headings, children }) => {
    return (
        <BasePage title={title} activeRoute={DOCS_SITE.basePath}>
            <div className="max-w-360 mx-auto px-4">
                <div className="sticky top-0 z-10 flex items-center gap-4 h-14 bg-gray border-b border-primary">
                    <button
                        id="docs-pages-button"
                        popovertarget="docs-pages-drawer"
                        aria-label={$ts`Pages`}
                        className="lg:hidden flex flex-col gap-1 p-2 rounded-sm cursor-pointer hover:bg-primary"
                    >
                        <span className="block w-5 h-0.5 bg-white"></span>
                        <span className="block w-5 h-0.5 bg-white"></span>
                        <span className="block w-5 h-0.5 bg-white"></span>
                    </button>
                    {/* a popover, which a click outside or Escape closes; a click on a page leaves this one */}
                    <div
                        id="docs-pages-drawer"
                        popover="auto"
                        className="inset-auto top-0 bottom-0 left-0 m-0 w-72 h-auto max-h-none overflow-y-auto p-4 border-0
                            border-r border-primary bg-dark-gray text-white shadow-elevation backdrop:bg-dark-gray/70"
                    >
                        <DocsSidebar current={file}/>
                    </div>
                    <div className="ml-auto">
                        <DocsSearchBox indexAddress={DocsUtilities.resolveSearchIndexAddress(DOCS_SITE)}/>
                    </div>
                </div>
                <div className="flex">
                    <aside
                        id="docs-sidebar"
                        className="hidden lg:block w-64 shrink-0 sticky top-14 self-start max-h-[calc(100vh-3.5rem)] overflow-y-auto
                            py-6 pr-4"
                    >
                        <DocsSidebar current={file}/>
                    </aside>
                    <main id="docs-content" className="min-w-0 flex-1 py-8 lg:px-8 text-white">
                        {children}
                    </main>
                    <aside
                        id="docs-on-this-page-column"
                        className="hidden xl:block w-60 shrink-0 sticky top-14 self-start max-h-[calc(100vh-3.5rem)] overflow-y-auto
                            py-6 pl-4"
                    >
                        <DocsOnThisPage headings={headings}/>
                    </aside>
                </div>
            </div>
            <DocsOnThisPageButton headings={headings}/>
        </BasePage>
    );
};