import { State, TsxComponent } from 'zibri';

type Props = {
    id: string,
    label: string | undefined,
    value: State<string>,
    className?: string
};

export const TextArea: TsxComponent<Props> = ({ label, id, className, value }) => {
    return (
        <div className={`flex flex-col gap-1 ${className}`}>
            {label && <label className="cursor-pointer" for={id}>
                {label}
            </label>}
            <textarea className={'p-1 border-none rounded resize-none'}
                autocomplete="off"
                id={id}
                value={value}
            />
        </div>
    );
};
