import { PreactComponent, TreeNode } from 'zibri';

import { Link } from './link';

type Props = { node: TreeNode, className?: string };

export const FileEntryComponent: PreactComponent<Props> = ({ node, className = '' }) => {
    if (node.type === 'directory') {
        return (
            <details className={`flex flex-col ${className}`}>
                <summary
                    className="bg-gray p-3 rounded leading-none cursor-pointer hover:bg-primary duration-200 ease-in"
                >
                    {node.name}
                </summary>
                <div className="flex flex-col gap-2 pt-2">
                    {node.children.map(n => <FileEntryComponent node={n} className="ml-4"></FileEntryComponent>)}
                </div>
            </details>
        );
    }

    return (
        <Link
            className={`bg-gray p-3 rounded leading-none hover:bg-primary hover:text-white ${className}`}
            href={node.route}
        >
            {node.name}
        </Link>
    );
};