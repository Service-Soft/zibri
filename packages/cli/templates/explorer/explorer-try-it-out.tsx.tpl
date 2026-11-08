import { Input, OpenApiReferenceObject, OpenApiSchemaObject, OpenApiSecuritySchemeType, Refs, State, TsxComponent, useContext, useInput, useRefs, useState } from 'zibri';

import { ExplorerCredentials, ExplorerServer } from './explorer-context';
import { ExplorerSchema } from './explorer-schema';
import { Button } from '../components/button';
import { Heading } from '../components/heading';

/**
 * A parameter of an operation, as the form asks for it.
 */
export type ExplorerRequestParameter = {
    name: string,
    location: 'path' | 'query' | 'header' | 'cookie',
    required: boolean,
    deprecated: boolean,
    description: string,
    typeName: string,
    // the text the field starts with
    value: string,
    // the values a select offers, empty for a text field
    options: string[],
    // a list, written separated by commas
    isArray: boolean
};

/**
 * A field of a form body, such as `multipart/form-data`.
 */
export type ExplorerFormField = {
    name: string,
    required: boolean,
    description: string,
    typeName: string,
    value: string,
    isFile: boolean,
    isArray: boolean
};

/**
 * One media type a request body can be sent as.
 */
export type ExplorerRequestBody = {
    mimeType: string,
    // the media type as a part of an id, such as `application-json`
    key: string,
    // the text the body starts with, for a body that is text
    example: string,
    // the fields, for a body that is a form
    fields: ExplorerFormField[],
    isForm: boolean,
    schema: OpenApiSchemaObject | OpenApiReferenceObject | undefined
};

/**
 * A security scheme an operation accepts, as a request applies what the user entered for it.
 */
export type ExplorerCredentialScheme = {
    name: string,
    type: OpenApiSecuritySchemeType,
    // the scheme of `http`, such as `bearer`
    scheme: string,
    // where an `apiKey` goes: `header`, `query` or `cookie`
    location: string,
    // the name of the header or query parameter of an `apiKey`
    parameterName: string
};

/**
 * What a request that was sent answered with.
 */
type ExplorerResult = {
    url: string,
    curl: string,
    status: string,
    durationInMs: number,
    headers: string,
    body: string,
    downloadUrl: string,
    downloadName: string,
    imageUrl: string,
    error: string
};

type Props = {
    id: string,
    method: string,
    path: string,
    version: string,
    versionHeader: string,
    parameters: ExplorerRequestParameter[],
    bodies: ExplorerRequestBody[],
    bodyRequired: boolean,
    bodyDescription: string,
    accepts: string[],
    schemes: ExplorerCredentialScheme[]
};

export const ExplorerTryItOut: TsxComponent<Props> = ({
    id,
    method,
    path,
    version,
    versionHeader,
    parameters,
    bodies,
    bodyRequired,
    bodyDescription,
    accepts,
    schemes
}) => {
    const credentials: Input<Record<string, string>> = useInput(useContext(ExplorerCredentials));
    const server: Input<string> = useInput(useContext(ExplorerServer));
    const running: State<boolean> = useState(false);
    const bodyType: State<string> = useState(bodies[0]?.mimeType ?? '');
    const accept: State<string> = useState(accepts[0] ?? '');
    const result: State<ExplorerResult | undefined> = useState<ExplorerResult | undefined>(undefined);
    const parameterInputs: Refs<HTMLInputElement | HTMLSelectElement> = useRefs<HTMLInputElement | HTMLSelectElement>();
    const bodyInputs: Refs<HTMLTextAreaElement> = useRefs<HTMLTextAreaElement>();
    const fieldInputs: Refs<HTMLInputElement> = useRefs<HTMLInputElement>();

    function quote(value: string): string {
        return `'${value.replaceAll('\'', '\'\\\'\'')}'`;
    }

    function readParameters(): { values: Map<string, string>, missing: string[] } {
        const values: Map<string, string> = new Map();
        const missing: string[] = [];
        for (const input of parameterInputs.current) {
            const key: string = `${input.dataset['location']}:${input.dataset['name']}`;
            if (input.value !== '') {
                values.set(key, input.value);
            }
            else if (input.dataset['required'] === 'true') {
                missing.push(input.dataset['name'] ?? '');
            }
        }
        return { values, missing };
    }

    function readBody(curl: string[]): BodyInit | undefined {
        const body: ExplorerRequestBody | undefined = bodies.find(b => b.mimeType === bodyType.value);
        if (body == undefined) {
            return undefined;
        }
        if (!body.isForm) {
            const text: string = bodyInputs.current.find(input => input.dataset['mimeType'] === body.mimeType)?.value ?? '';
            if (text === '') {
                return undefined;
            }
            curl.push(`-H ${quote(`Content-Type: ${body.mimeType}`)}`, `-d ${quote(text)}`);
            return text;
        }
        const form: FormData = new FormData();
        for (const input of fieldInputs.current.filter(field => field.dataset['mimeType'] === body.mimeType)) {
            const name: string = input.dataset['name'] ?? '';
            if (input.type === 'file') {
                for (const file of input.files ?? []) {
                    form.append(name, file);
                    curl.push(`-F ${quote(`${name}=@${file.name}`)}`);
                }
                continue;
            }
            const values: string[] = input.dataset['array'] === 'true' ? input.value.split(',').filter(v => v !== '') : [input.value];
            for (const value of values.filter(v => v !== '')) {
                form.append(name, value);
                curl.push(`-F ${quote(`${name}=${value}`)}`);
            }
        }
        if (body.mimeType === 'application/x-www-form-urlencoded') {
            const encoded: URLSearchParams = new URLSearchParams();
            for (const [name, value] of form.entries()) {
                encoded.append(name, typeof value === 'string' ? value : value.name);
            }
            return encoded;
        }
        return form;
    }

    async function readImage(blob: Blob): Promise<string> {
        return await new Promise(resolve => {
            const reader: FileReader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
            reader.readAsDataURL(blob);
        });
    }

    async function execute(): Promise<void> {
        const { values, missing } = readParameters();
        if (missing.length) {
            result.value = {
                url: '',
                curl: '',
                status: '',
                durationInMs: 0,
                headers: '',
                body: '',
                downloadUrl: '',
                downloadName: '',
                imageUrl: '',
                error: `Required: ${missing.join(', ')}`
            };
            return;
        }
        const base: string = server.value === '' ? location.origin : new URL(server.value, location.origin).href.replace(/\/$/, '');
        const url: URL = new URL(base + path.replaceAll(/\{([^}]+)\}/g, (_, name: string) => encodeURIComponent(values.get(`path:${name}`) ?? '')));
        const headers: Headers = new Headers();
        for (const parameter of parameters) {
            const value: string | undefined = values.get(`${parameter.location}:${parameter.name}`);
            if (value == undefined) {
                continue;
            }
            if (parameter.location === 'query') {
                for (const item of parameter.isArray ? value.split(',') : [value]) {
                    url.searchParams.append(parameter.name, item);
                }
            }
            if (parameter.location === 'header') {
                headers.set(parameter.name, value);
            }
            if (parameter.location === 'cookie') {
                document.cookie = `${encodeURIComponent(parameter.name)}=${encodeURIComponent(value)}; path=/`;
            }
        }
        for (const scheme of schemes) {
            const credential: string | undefined = credentials.value[scheme.name];
            if (credential == undefined || credential === '') {
                continue;
            }
            if (scheme.type === 'http' && scheme.scheme.toLowerCase() === 'basic') {
                headers.set('Authorization', `Basic ${btoa(credential)}`);
            }
            else if (scheme.type === 'http' || scheme.type === 'oauth2' || scheme.type === 'openIdConnect') {
                headers.set('Authorization', `Bearer ${credential}`);
            }
            else if (scheme.type === 'apiKey' && scheme.location === 'header') {
                headers.set(scheme.parameterName, credential);
            }
            else if (scheme.type === 'apiKey' && scheme.location === 'query') {
                url.searchParams.set(scheme.parameterName, credential);
            }
        }
        headers.set(versionHeader, version);
        if (accept.value !== '') {
            headers.set('Accept', accept.value);
        }
        const curl: string[] = [`curl -X ${method.toUpperCase()} ${quote(url.href)}`];
        for (const [name, value] of headers.entries()) {
            curl.push(`-H ${quote(`${name}: ${value}`)}`);
        }
        const body: BodyInit | undefined = readBody(curl);
        if (typeof body === 'string') {
            headers.set('Content-Type', bodyType.value);
        }

        running.value = true;
        const started: number = performance.now();
        try {
            const response: Response = await fetch(url, { method: method.toUpperCase(), headers, body, credentials: 'same-origin' });
            const contentType: string = response.headers.get('content-type') ?? '';
            const disposition: string = response.headers.get('content-disposition') ?? '';
            let text: string = '';
            let downloadUrl: string = '';
            let imageUrl: string = '';
            // a file sent as an attachment is offered to download, whatever it holds
            if (disposition.startsWith('attachment')) {
                downloadUrl = URL.createObjectURL(await response.blob());
            }
            else if (contentType.includes('json')) {
                text = await response.text();
                try {
                    text = JSON.stringify(JSON.parse(text), undefined, 2);
                }
                catch {
                    // shown as it came
                }
            }
            else if (contentType === '' || contentType.startsWith('text/') || contentType.includes('xml')) {
                text = await response.text();
            }
            else {
                const blob: Blob = await response.blob();
                downloadUrl = URL.createObjectURL(blob);
                imageUrl = contentType.startsWith('image/') ? await readImage(blob) : '';
            }
            result.value = {
                url: url.href,
                curl: curl.join(' \\\n    '),
                status: `${response.status} ${response.statusText}`,
                durationInMs: Math.round(performance.now() - started),
                headers: [...response.headers.entries()].map(([name, value]) => `${name}: ${value}`).join('\n'),
                body: text,
                downloadUrl,
                downloadName: /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'download',
                imageUrl,
                error: ''
            };
        }
        catch (error) {
            result.value = {
                url: url.href,
                curl: curl.join(' \\\n    '),
                status: '',
                durationInMs: Math.round(performance.now() - started),
                headers: '',
                body: '',
                downloadUrl: '',
                downloadName: '',
                imageUrl: '',
                error: `The request failed: ${String(error)}`
            };
        }
        finally {
            running.value = false;
        }
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex gap-4 items-center justify-between py-2 border-b border-gray">
                <Heading tag="h4" className="text-lg! font-semibold">Parameters</Heading>
            </div>
            {parameters.length
                ? <table className="w-full border-collapse">
                    <tbody>
                        {parameters.map(parameter => <tr>
                            <td className="w-1/4 align-top py-2 px-1 border-b border-gray font-semibold">
                                <span className={parameter.deprecated ? 'line-through' : ''}>{parameter.name}</span>
                                {parameter.required && <span className="text-[#f93e3e]" title="required">*</span>}
                                <div className="font-mono text-sm font-normal text-secondary">{parameter.typeName}</div>
                                <div className="text-sm italic font-normal text-disabled">({parameter.location})</div>
                            </td>
                            <td className="align-top py-2 px-1 border-b border-gray">
                                {parameter.description !== '' && <p>{parameter.description}</p>}
                                {parameter.options.length
                                    ? <select
                                        id={`${id}-parameter-${parameter.location}-${parameter.name}`}
                                        ref={parameterInputs}
                                        data-name={parameter.name}
                                        data-location={parameter.location}
                                        data-required={String(parameter.required)}
                                        className="px-2 py-1.5 rounded border border-disabled-dark bg-dark-gray text-white"
                                    >
                                        <option value="">--</option>
                                        {parameter.options.map(option => <option value={option} selected={option === parameter.value}>{option}</option>)}
                                    </select>
                                    : <input
                                        id={`${id}-parameter-${parameter.location}-${parameter.name}`}
                                        ref={parameterInputs}
                                        data-name={parameter.name}
                                        data-location={parameter.location}
                                        data-required={String(parameter.required)}
                                        value={parameter.value}
                                        placeholder={parameter.isArray ? `${parameter.name}, separated by commas` : parameter.name}
                                        className="w-full px-2 py-1.5 rounded border border-disabled-dark bg-dark-gray text-white"
                                    />}
                            </td>
                        </tr>)}
                    </tbody>
                </table>
                : <p className="text-disabled">No parameters</p>}
            {bodies.length > 0 && <div className="flex flex-col gap-2">
                <div className="flex gap-4 items-center justify-between py-2 border-b border-gray">
                    <Heading tag="h4" className="text-lg! font-semibold">
                        Request body{bodyRequired && <span className="text-[#f93e3e]" title="required">*</span>}
                    </Heading>
                    <select id={`${id}-body-type`} value={bodyType} className="px-2 py-1.5 rounded border border-disabled-dark bg-dark-gray text-white">
                        {bodies.map(body => <option value={body.mimeType}>{body.mimeType}</option>)}
                    </select>
                </div>
                {bodyDescription !== '' && <p>{bodyDescription}</p>}
                {bodies.map(body => <div className="flex flex-col gap-2 mt-2" hidden={bodyType.value !== body.mimeType}>
                    {body.isForm
                        ? <table className="w-full border-collapse">
                            <tbody>
                                {body.fields.map(field => <tr>
                                    <td className="w-1/4 align-top py-2 px-1 border-b border-gray font-semibold">
                                        {field.name}
                                        {field.required && <span className="text-[#f93e3e]" title="required">*</span>}
                                        <div className="font-mono text-sm font-normal text-secondary">{field.typeName}</div>
                                    </td>
                                    <td className="align-top py-2 px-1 border-b border-gray">
                                        {field.description !== '' && <p>{field.description}</p>}
                                        <input
                                            id={`${id}-field-${body.key}-${field.name}`}
                                            ref={fieldInputs}
                                            data-name={field.name}
                                            data-mime-type={body.mimeType}
                                            data-array={String(field.isArray)}
                                            type={field.isFile ? 'file' : 'text'}
                                            multiple={field.isFile && field.isArray}
                                            value={field.isFile ? undefined : field.value}
                                            className="w-full px-2 py-1.5 rounded border border-disabled-dark bg-dark-gray text-white"
                                        />
                                    </td>
                                </tr>)}
                            </tbody>
                        </table>
                        : <textarea
                            id={`${id}-body-${body.key}`}
                            ref={bodyInputs}
                            data-mime-type={body.mimeType}
                            className="w-full p-2 rounded border border-disabled-dark bg-dark-gray text-white font-mono text-sm resize-y"
                            rows={Math.min(20, Math.max(4, body.example.split('\n').length))}
                            value={body.example}
                        />}
                    {body.schema != undefined && <ExplorerSchema schema={body.schema}/>}
                </div>)}
            </div>}
            <div className="flex flex-wrap gap-3 items-center">
                {accepts.length > 0 && <label className="inline-flex gap-2 items-center">
                    Accept
                    <select id={`${id}-accept`} value={accept} className="px-2 py-1.5 rounded border border-disabled-dark bg-dark-gray text-white">
                        {accepts.map(type => <option value={type}>{type}</option>)}
                    </select>
                </label>}
                <Button id={`${id}-execute`} disabled={running.value} onClick={() => void execute()}>
                    {running.value ? 'Sending...' : 'Execute'}
                </Button>
                <Button
                    id={`${id}-clear`}
                    onClick={() => {
                        result.value = undefined;
                    }}
                >
                    Clear
                </Button>
            </div>
            {result.value != undefined && <div id={`${id}-result`} className="flex flex-col gap-1">
                <p id={`${id}-result-error`} className="text-[#f93e3e] font-semibold" hidden={result.value.error === ''}>{result.value.error}</p>
                <h5 className="font-semibold" hidden={result.value.curl === ''}>Curl</h5>
                <pre id={`${id}-result-curl`} className="my-1 p-2.5 overflow-auto max-h-96 rounded bg-[#111119] font-mono text-sm whitespace-pre-wrap break-all" hidden={result.value.curl === ''}>{result.value.curl}</pre>
                <h5 className="font-semibold" hidden={result.value.url === ''}>Request URL</h5>
                <pre id={`${id}-result-url`} className="my-1 p-2.5 overflow-auto max-h-96 rounded bg-[#111119] font-mono text-sm whitespace-pre-wrap break-all" hidden={result.value.url === ''}>{result.value.url}</pre>
                <h5 className="font-semibold" hidden={result.value.status === ''}>Response</h5>
                <p hidden={result.value.status === ''}>
                    <span id={`${id}-result-status`} className="font-bold">{result.value.status}</span>
                    <span className="text-disabled"> in {result.value.durationInMs} ms</span>
                </p>
                <pre id={`${id}-result-body`} className="my-1 p-2.5 overflow-auto max-h-96 rounded bg-[#111119] font-mono text-sm whitespace-pre-wrap break-all" hidden={result.value.body === ''}>{result.value.body}</pre>
                <img id={`${id}-result-image`} className="max-w-full" alt="The image the response holds" src={result.value.imageUrl} hidden={result.value.imageUrl === ''}/>
                <a id={`${id}-result-download`} className="text-secondary underline" href={result.value.downloadUrl} download={result.value.downloadName} hidden={result.value.downloadUrl === ''}>Download the file</a>
                <h5 className="font-semibold" hidden={result.value.headers === ''}>Response headers</h5>
                <pre id={`${id}-result-headers`} className="my-1 p-2.5 overflow-auto max-h-96 rounded bg-[#111119] font-mono text-sm whitespace-pre-wrap break-all" hidden={result.value.headers === ''}>{result.value.headers}</pre>
            </div>}
        </div>
    );
};