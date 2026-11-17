import { DocsPage, DocsUtilities, TsxComponent } from 'zibri';

import { API_FOLDER } from '../../api/api-reference.utilities';
import { BASE_PATH } from '../../base-path';
import { DOCS_SITE } from '../../navigation/docs-site';

type SidebarProps = {
    // the file of the page that renders, which the sidebar marks; the folder of the API reference for one of its pages
    current: string
};

type SidebarLinkProps = {
    href: string,
    title: string,
    active: boolean
};

type SidebarPageLinkProps = {
    page: DocsPage,
    current: string
};

const SidebarLink: TsxComponent<SidebarLinkProps> = ({ href, title, active }) => {
    return (
        <a
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`block px-3 py-1 rounded-sm ${active ? 'bg-primary text-white' : 'text-disabled hover:text-secondary'}`}
        >
            {title}
        </a>
    );
};

const SidebarPageLink: TsxComponent<SidebarPageLinkProps> = ({ page, current }) => {
    return (
        <SidebarLink
            href={DocsUtilities.resolveAddress(DOCS_SITE, page.file)}
            title={DocsUtilities.resolveTitle(page)}
            active={page.file === current}
        />
    );
};

// every page, a folder open while one of its pages renders, and the API reference last
export const Sidebar: TsxComponent<SidebarProps> = ({ current }) => {
    return (
        <nav aria-label="Pages" className="flex flex-col gap-1 text-sm">
            {DOCS_SITE.navigation.map(entry => DocsUtilities.isPage(entry)
                ? <SidebarPageLink page={entry} current={current}/>
                : <details open={entry.pages.some(page => page.file === current)} className="group">
                    <summary className="px-3 py-1 cursor-pointer text-secondary text-xs uppercase font-semibold tracking-widest">
                        {entry.title}
                    </summary>
                    <div className="ml-3 pl-2 border-l border-primary">
                        {entry.pages.map(page => <SidebarPageLink page={page} current={current}/>)}
                    </div>
                </details>)}
            <SidebarLink href={`${BASE_PATH}/${API_FOLDER}/`} title="API reference" active={current === API_FOLDER}/>
        </nav>
    );
};