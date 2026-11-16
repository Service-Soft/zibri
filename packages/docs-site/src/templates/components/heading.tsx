import { MdxHeadingProps, TsxComponent, useContext } from 'zibri';

import { HeadingLink } from './heading-link';
import { PageSection, PageSectionContext } from './page-section-context';

type HeadingLevel = MdxHeadingProps['tag'];

const LEVEL_CLASSES: Record<HeadingLevel, string> = {
    h1: 'mb-6 text-4xl',
    h2: 'mt-12 mb-4 pb-2 border-b border-primary text-2xl',
    h3: 'mt-8 mb-3 text-xl',
    h4: 'mt-6 mb-2 text-lg font-semibold',
    h5: 'mt-6 mb-2 text-base font-semibold',
    h6: 'mt-6 mb-2 text-sm font-semibold'
};

// a heading of a page, which a link to its anchor scrolls to below the bar at the top, and a section beside the link
// that copies its address. A `##` starts a section, which what renders below it, such as a table of key exports, is in
export const Heading: TsxComponent<MdxHeadingProps> = ({ tag, id, children }) => {
    const section: PageSection | undefined = useContext(PageSectionContext);
    if (section !== undefined && tag === 'h2') {
        section.id = id ?? '';
    }
    const TagName: HeadingLevel = tag;
    return (
        <TagName id={id} className={`group scroll-mt-20 text-white tracking-wider ${LEVEL_CLASSES[tag]}`}>
            {children}
            {id !== undefined && tag !== 'h1' && <HeadingLink id={id}/>}
        </TagName>
    );
};