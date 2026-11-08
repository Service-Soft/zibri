import { Ref, TsxComponent, TsxChildren } from 'zibri';

type Props = {
    id?: string,
    className?: string,
    dialogRef?: Ref<HTMLDialogElement>,
    children: TsxChildren
};

export const Dialog: TsxComponent<Props> = ({ children, id, className = '', dialogRef }) => {
    // m-auto, because Tailwind's reset takes away the margin the browser centers a modal dialog with
    return <dialog id={id} ref={dialogRef} className={`m-auto rounded-2xl border-none ${className}`}>
        {children}
    </dialog>;
};