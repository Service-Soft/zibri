import { ComponentChildren } from 'preact';
import { PreactComponent } from 'zibri';

type Props = {
    type?: 'submit' | 'reset' | 'button',
    id?: string,
    className?: string,
    disabled?: boolean,
    children: ComponentChildren,
    onClick?: () => void
};

export const Button: PreactComponent<Props> = ({
    type = 'button',
    id,
    className = '',
    children,
    disabled,
    onClick
}) => {
    return (
        <button
            id={id}
            type={type}
            disabled={disabled}
            className={`inline-block rounded bg-gray w-fit text-white p-4 transition duration-300 ease-in
                hover:bg-primary cursor-pointer disabled:bg-disabled-dark disabled:text-disabled 
                disabled:cursor-not-allowed ${className}`}
            onClick={() => void onClick?.()}
        >
            {children}
        </button>
    );
};