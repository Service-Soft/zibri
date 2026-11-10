import { DocsUtilities, MdxLinkProps, TsxComponent, useContext } from 'zibri';

import { DocsPageContext } from './docs-page-context';
import { DOCS_SITE } from './docs-site';

// a link of a page, which names another page by its file, as GitHub follows it, and leads to that page
export const DocsLink: TsxComponent<MdxLinkProps> = ({ href, title, children }) => {
    const file: string = useContext(DocsPageContext);
    return (
        <a href={DocsUtilities.resolveLink(DOCS_SITE, href, file)} title={title} className="text-secondary hover:underline">
            {children}
        </a>
    );
};