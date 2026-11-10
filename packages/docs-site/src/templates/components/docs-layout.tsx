import { MdxHeading, TsxChildren, TsxComponent } from 'zibri';

import { OnThisPage } from './on-this-page';
import { OnThisPageButton } from './on-this-page-button';
import { SearchBox } from './search-box';
import { Sidebar } from './sidebar';
import { BASE_PATH } from '../../base-path';
import { SEARCH_INDEX_ADDRESS } from '../../search/search-index.utilities';

type DocsLayoutProps = {
    title: string,
    // the file of the page, which the sidebar marks
    file: string,
    headings: MdxHeading[],
    children: TsxChildren
};

// the bar at the top, the pages beside the content, and the sections of the page beside it on a wide screen. On a
// narrow one the pages are behind a button of the bar
export const DocsLayout: TsxComponent<DocsLayoutProps> = ({ title, file, headings, children }) => {
    return (
        <html lang="en">
            <head>
                <meta charset="utf-8"/>
                <title>{`${title} | Zibri`}</title>
                <meta name="viewport" content="width=device-width, initial-scale=1"/>
                <link rel="icon" type="image/png" href={`${BASE_PATH}/assets/favicon.png`}/>
                <link rel="stylesheet" href={`${BASE_PATH}/assets/style.css`}/>
            </head>
            <body className="bg-gray text-white">
                <header className="sticky top-0 z-10 bg-dark-gray shadow-elevation">
                    {/* the width and padding of the columns below, so the bar starts and ends where they do */}
                    <div className="flex items-center gap-4 h-14 max-w-360 mx-auto px-6 lg:px-4">
                        <button
                            id="pages-button"
                            popovertarget="pages-drawer"
                            aria-label="Pages"
                            className="lg:hidden flex flex-col gap-1 p-2 rounded-sm cursor-pointer hover:bg-primary"
                        >
                            <span className="block w-5 h-0.5 bg-white"></span>
                            <span className="block w-5 h-0.5 bg-white"></span>
                            <span className="block w-5 h-0.5 bg-white"></span>
                        </button>
                        {/* a popover, which a click outside or Escape closes; a click on a page leaves this one */}
                        <div
                            id="pages-drawer"
                            popover="auto"
                            className="inset-auto top-0 bottom-0 left-0 m-0 w-72 h-auto max-h-none overflow-y-auto p-4 border-0
                                border-r border-primary bg-dark-gray text-white shadow-elevation backdrop:bg-dark-gray/70"
                        >
                            <Sidebar current={file}/>
                        </div>
                        <a id="home-link" href={`${BASE_PATH}/`} className="flex items-center gap-2 text-xl tracking-wider font-semibold">
                            {/* the link's text names it */}
                            <img src={`${BASE_PATH}/assets/favicon.png`} alt="" className="w-9 h-9"/>
                            Zibri
                        </a>
                        <div className="ml-auto">
                            <SearchBox indexAddress={SEARCH_INDEX_ADDRESS}/>
                        </div>
                        <a id="github-link" href="https://github.com/Service-Soft/zibri" className="opacity-75 hover:opacity-100">
                            <img src={`${BASE_PATH}/assets/github.svg`} alt="GitHub" className="w-6 h-6"/>
                        </a>
                    </div>
                </header>
                {/* as wide as the three columns, the page's at most 56rem, so the outer two end where the bar does */}
                <div className="flex max-w-360 mx-auto">
                    <aside id="sidebar" className="hidden lg:block w-72 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto p-4">
                        <Sidebar current={file}/>
                    </aside>
                    <main id="content" className="min-w-0 flex-1 px-6 lg:px-10 py-8">
                        {children}
                    </main>
                    <aside
                        id="on-this-page-column"
                        className="hidden xl:block w-64 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto p-4"
                    >
                        <OnThisPage headings={headings}/>
                    </aside>
                </div>
                <OnThisPageButton headings={headings}/>
            </body>
        </html>
    );
};