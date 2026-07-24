import { TsxComponent, TsxChildren } from 'zibri';

type Props = {
    children: TsxChildren,
    onSubmit: () => void,
    className?: string
};

export const Form: TsxComponent<Props> = ({ onSubmit, children, className = '' }: Props) => {
    return <form className={className} onSubmit={ev => {
        ev.preventDefault();
        onSubmit();
    } }>
        {children}
    </form>;
};