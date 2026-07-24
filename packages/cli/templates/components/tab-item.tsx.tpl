import { TsxComponent, TsxChildren } from 'zibri';

type Props = {
    id: string,
    children: TsxChildren,
    className?: string
};

export const TabItem: TsxComponent<Props> = ({ id, className = '', children }) => {
    return (
        <div id={id} className={className}>
            {children}
        </div>
    );
};