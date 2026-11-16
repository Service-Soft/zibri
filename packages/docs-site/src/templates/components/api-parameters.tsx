import type { JSONOutput } from 'typedoc' with { 'resolution-mode': 'import' };
import { Markdown, TsxComponent } from 'zibri';

import { InlineCode } from './inline-code';
import { Table } from './table';
import { TableBody } from './table-body';
import { TableCell } from './table-cell';
import { TableHead } from './table-head';
import { TableRow } from './table-row';
import { ApiCommentUtilities } from '../../api/api-comment.utilities';

type ApiParametersProps = {
    parameters: JSONOutput.ParameterReflection[] | undefined
};

// what the parameters of a signature are for, where its JSDoc says it; their types are in the signature
export const ApiParameters: TsxComponent<ApiParametersProps> = ({ parameters }) => {
    if (parameters?.some(parameter => parameter.comment != undefined) !== true) {
        return <></>;
    }
    return (
        <Table>
            <TableHead>
                <TableRow head={true}>
                    <TableCell head={true}>Parameter</TableCell>
                    <TableCell head={true}>Description</TableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {parameters.map(parameter => <TableRow head={false}>
                    <TableCell head={false}><InlineCode code={parameter.name}>{parameter.name}</InlineCode></TableCell>
                    <TableCell head={false}><Markdown source={ApiCommentUtilities.resolveSummaryMarkdown(parameter.comment)}/></TableCell>
                </TableRow>)}
            </TableBody>
        </Table>
    );
};