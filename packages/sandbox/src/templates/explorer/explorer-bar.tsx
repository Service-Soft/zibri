import { TsxChildren, TsxComponent } from 'zibri';

type Props = {
    id: string,
    children: TsxChildren
};

// the band a document starts with, the same on both tabs
export const ExplorerBar: TsxComponent<Props> = ({ id, children }) => <div
    id={id}
    className="flex flex-wrap gap-4 items-center p-4 rounded bg-dark-gray"
>
    {children}
</div>;