import { OpenApiExampleDirection, OpenApiExplorerSchemaSource, OpenApiExplorerUtilities, OpenApiMediaTypeObject, TsxComponent, useContext } from 'zibri';

import { ExplorerDefinition } from './explorer-context';
import { ExplorerSchema } from './explorer-schema';

type Props = {
    id: string,
    mimeType: string,
    content: OpenApiMediaTypeObject,
    direction: OpenApiExampleDirection
};

export const ExplorerContent: TsxComponent<Props> = ({ id, mimeType, content, direction }) => {
    const definition: OpenApiExplorerSchemaSource = useContext(ExplorerDefinition);
    const example: string = OpenApiExplorerUtilities.resolveContentExample(definition, mimeType, content, direction);

    return (
        <div id={id} className="flex flex-col gap-1 my-2">
            <span className="self-start px-2 rounded bg-dark-gray font-mono text-sm">{mimeType}</span>
            {content.schema != undefined && <ExplorerSchema schema={content.schema}/>}
            {example !== '' && <details>
                <summary className="cursor-pointer">Example</summary>
                <pre id={`${id}-example`} className="my-1 p-2.5 overflow-auto max-h-96 rounded bg-[#111119] font-mono text-sm whitespace-pre-wrap break-all">{example}</pre>
            </details>}
        </div>
    );
};
