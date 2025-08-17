import React from 'react';

const InputField: React.FC<React.InputHTMLAttributes<HTMLInputElement> & {label?: string}> = ({label, id, ...props}) => (
    <div>
        {label && <label htmlFor={id} className={`block mb-1.5 text-sm font-medium text-slate-200`}>{props.required && <span className="text-red-400 mr-1">*</span>}{label}</label>}
        <input id={id} {...props} className={`${props.className || ''} form-input p-2.5 text-sm`} />
    </div>
);

export default InputField;
