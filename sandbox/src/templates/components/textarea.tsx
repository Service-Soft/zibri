import { PreactComponent } from 'zibri';

type Props = {
    id: string,
    label: string | undefined,
    onChange?: (value: string) => void,
    className?: string
};

export const TextArea: PreactComponent<Props> = ({ label, id, className, onChange }) => {
    return (
        <div className={`flex flex-col gap-1 ${className}`}>
            {label && <label className="cursor-pointer" for={id}>
                {label}
            </label>}
            <textarea onChange={(ev) => onChange?.(ev.currentTarget.value)}
                className={'p-1 border-none rounded resize-none'}
                autocomplete="off"
                id={id}
            />
        </div>
    );
};