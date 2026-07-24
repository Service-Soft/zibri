import { TsxComponent, TsxChildren } from 'zibri';

type Props = {
    className?: string,
    children: TsxChildren
};

export const Card: TsxComponent<Props> = ({ className = '', children }) => {
    return <div className={`p-4 rounded bg-dark-gray text-white shadow-elevation ${className}`}>
        {children}
    </div>;
};