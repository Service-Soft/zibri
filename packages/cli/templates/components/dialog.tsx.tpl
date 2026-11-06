import { Ref, TsxComponent, TsxChildren } from 'zibri';

type Props = {
    id?: string,
    className?: string,
    dialogRef?: Ref<HTMLDialogElement>,
    children: TsxChildren
};

export const Dialog: TsxComponent<Props> = ({ children, id, className = '', dialogRef }) => {
    return <dialog id={id} ref={dialogRef} className={`rounded-2xl border-none ${className}`}>
        {children}
    </dialog>;
};