import { MdxHeadingProps, TsxComponent } from 'zibri';

import { DocsHeadingLink } from './docs-heading-link';
import { Heading } from '../components/heading';

type HeadingLevel = MdxHeadingProps['tag'];

const SPACING_CLASSES: Record<HeadingLevel, string> = {
    h1: 'mb-6',
    h2: 'mt-12 mb-4 pb-2 border-b border-primary',
    h3: 'mt-8 mb-3',
    h4: 'mt-6 mb-2',
    h5: 'mt-6 mb-2',
    h6: 'mt-6 mb-2'
};

// a heading of a page of the documentation, a section underlined, beside the link that copies its address. A link to its
// anchor scrolls it below the bar at the top of the page
export const DocsHeading: TsxComponent<MdxHeadingProps> = ({ tag, id, children }) => {
    return (
        <Heading tag={tag} id={id} className={`group scroll-mt-20 ${SPACING_CLASSES[tag]}`}>
            {children}
            {id !== undefined && tag !== 'h1' && <DocsHeadingLink id={id}/>}
        </Heading>
    );
};