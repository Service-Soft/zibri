import { DocsPage, DocsUtilities, MdxPage, provideContext, TsxComponent } from 'zibri';

import { DocsLayout } from '../components/docs-layout';
import { DocsPageContext } from '../components/docs-page-context';
import { PageSection, PageSectionContext } from '../components/page-section-context';

type DocsPageProps = {
    page: DocsPage
};

// a page of the documentation inside the layout of the site
export const DocsPageTemplate: TsxComponent<DocsPageProps> = ({ page }) => {
    const section: PageSection = { id: '' };
    provideContext(DocsPageContext, page.file);
    provideContext(PageSectionContext, section);
    const Content: MdxPage = page.module.default;
    return (
        <DocsLayout title={DocsUtilities.resolveTitle(page)} file={page.file} headings={page.module.headings}>
            <Content/>
        </DocsLayout>
    );
};