import { DocsUtilities, MdxLinkProps, provideContext, TsxComponent, useContext } from 'zibri';

import { DocsPageContext } from './docs-page-context';
import { InsideLinkContext } from './inside-link-context';
import { DOCS_SITE } from '../../navigation/docs-site';

// a link of a page, which names another page by its file, as GitHub follows it, and leads to that page of the site
export const Link: TsxComponent<MdxLinkProps> = ({ href, title, children }) => {
    const file: string = useContext(DocsPageContext);
    provideContext(InsideLinkContext, true);
    return (
        <a href={DocsUtilities.resolveLink(DOCS_SITE, href, file)} title={title} className="text-secondary hover:underline">
            {children}
        </a>
    );
};