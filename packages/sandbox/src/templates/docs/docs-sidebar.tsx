import { $ts, DocsPage, DocsUtilities, TsxComponent } from 'zibri';

import { DOCS_SITE } from './docs-site';

type DocsSidebarProps = {
    // the file of the page that renders, which the sidebar marks
    current: string
};

type DocsSidebarLinkProps = {
    page: DocsPage,
    current: string
};

const DocsSidebarLink: TsxComponent<DocsSidebarLinkProps> = ({ page, current }) => {
    const active: boolean = page.file === current;
    return (
        <a
            href={DocsUtilities.resolveAddress(DOCS_SITE, page.file)}
            aria-current={active ? 'page' : undefined}
            className={`block px-3 py-1 rounded-sm ${active ? 'bg-primary text-white' : 'text-disabled hover:text-secondary'}`}
        >
            {DocsUtilities.resolveTitle(page)}
        </a>
    );
};

// every page, a folder open while one of its pages renders
export const DocsSidebar: TsxComponent<DocsSidebarProps> = ({ current }) => {
    return (
        <nav aria-label={$ts`Pages`} className="flex flex-col gap-1 text-sm">
            {DOCS_SITE.navigation.map(entry => DocsUtilities.isPage(entry)
                ? <DocsSidebarLink page={entry} current={current}/>
                : <details open={entry.pages.some(page => page.file === current)}>
                    <summary className="px-3 py-1 cursor-pointer text-secondary text-xs uppercase font-semibold tracking-widest">
                        {entry.title}
                    </summary>
                    <div className="ml-3 pl-2 border-l border-primary">
                        {entry.pages.map(page => <DocsSidebarLink page={page} current={current}/>)}
                    </div>
                </details>)}
        </nav>
    );
};