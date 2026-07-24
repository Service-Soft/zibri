import { TsxComponent, TsxChildren } from 'zibri';

type Props = {
    id?: string,
    className?: string,
    children: TsxChildren
};

export const Dialog: TsxComponent<Props> = ({ children, id, className = '' }) => {
    return <dialog id={id} className={`rounded-2xl border-none ${className}`}>
        {children}
    </dialog>;
};