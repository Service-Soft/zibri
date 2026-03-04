import { PreactComponent, TreeNode } from 'zibri';

import { BasePage } from '../components/base-page';
import { Card } from '../components/card';
import { FileEntryComponent } from '../components/file-entry';
import { Heading } from '../components/heading';

type Props = {
    nodes: TreeNode[]
};

export const AssetsPage: PreactComponent<Props> = ({ nodes }) => {
    return (
        <BasePage title='Assets' activeRoute='/assets' className="flex flex-col gap-4 py-8">
            <Heading className="text-center">Assets</Heading>
            <Card className="overflow-scroll h-[520px] min-w-[500px] mx-auto">
                <div className="flex flex-col gap-2">
                    {nodes.map(n => <FileEntryComponent node={n}></FileEntryComponent>)}
                </div>
            </Card>
        </BasePage>
    );
};