import { DocsPage, DocsUtilities, MdxPage, provideContext, TsxComponent } from 'zibri';

import { DocsLayout } from './docs-layout';
import { docsMarkdownComponents } from './docs-markdown-components';
import { DocsPageContext } from './docs-page-context';

type DocsPageProps = {
    page: DocsPage
};

// a page of the documentation, its links relative to its file
export const DocsPageTemplate: TsxComponent<DocsPageProps> = ({ page }) => {
    provideContext(DocsPageContext, page.file);
    const Content: MdxPage = page.module.default;
    return (
        <DocsLayout title={DocsUtilities.resolveTitle(page)} file={page.file} headings={page.module.headings}>
            <Content components={docsMarkdownComponents}/>
        </DocsLayout>
    );
};