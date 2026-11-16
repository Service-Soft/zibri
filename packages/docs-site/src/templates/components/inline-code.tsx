import { MdxInlineCodeProps, TsxComponent, TsxElement, useContext } from 'zibri';

import { InsideLinkContext } from './inside-link-context';
import { KindBadge } from './kind-badge';
import { ApiCodeTarget } from '../../api/api-export.model';
import { ApiReferenceUtilities } from '../../api/api-reference.utilities';

// a code span naming an export of zibri, such as `MarkdownService`, leads to its page in the API reference, its kind
// in front of it
export const InlineCode: TsxComponent<MdxInlineCodeProps> = ({ code: written, children }) => {
    const insideLink: boolean = useContext(InsideLinkContext);
    const target: ApiCodeTarget | undefined = insideLink ? undefined : ApiReferenceUtilities.findCodeTarget(written);
    const code: TsxElement = <code className="px-1 rounded-sm bg-primary/50 text-sm">{children}</code>;
    if (target == undefined) {
        return code;
    }
    return (
        // inline, so the code stays on the line of the text, and the badge with it
        <a href={target.address} className="whitespace-nowrap text-secondary hover:underline">
            <KindBadge kind={target.kind} size="small"/>
            {code}
        </a>
    );
};