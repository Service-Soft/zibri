import type { JSONOutput } from 'typedoc' with { 'resolution-mode': 'import' };
import { Markdown, TsxComponent } from 'zibri';

import { ApiParameters } from './api-parameters';
import { ApiCommentUtilities } from '../../api/api-comment.utilities';

type ApiCommentProps = {
    comment: JSONOutput.Comment | undefined,
    // the parameters of the signature the comment is of, which come after its summary
    parameters?: JSONOutput.ParameterReflection[]
};

// the JSDoc of an export or a member as markdown, which renders as the pages written in markdown do: its summary, what
// its parameters are for, then the rest, such as what it returns
export const ApiComment: TsxComponent<ApiCommentProps> = ({ comment, parameters }) => {
    const summary: string = ApiCommentUtilities.resolveSummaryMarkdown(comment);
    const blockTags: string = ApiCommentUtilities.resolveBlockTagsMarkdown(comment);
    return (
        <>
            {summary === '' ? <></> : <Markdown source={summary}/>}
            <ApiParameters parameters={parameters}/>
            {blockTags === '' ? <></> : <Markdown source={blockTags}/>}
        </>
    );
};