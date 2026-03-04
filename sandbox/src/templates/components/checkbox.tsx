import { PreactComponent } from 'zibri';

type Props = {
    label: string,
    onChange?: () => void,
    checked?: boolean,
    id?: string
};

export const Checkbox: PreactComponent<Props> = ({ label, id = label, checked, onChange }) => {
    return (
        <div className="flex justify-center items-center gap-1">
            <input className="w-5 h-5 bg-secondary text-secondary cursor-pointer"
                checked={checked}
                onChange={() => onChange?.()}
                id={id}
                type="checkbox"
            />
            <label className="cursor-pointer select-none" for={id}>
                {label}
            </label>
        </div>
    );
};