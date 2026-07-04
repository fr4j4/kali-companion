import { Select, type SelectOption } from "../ui/Select";

interface FieldBase {
  label: string;
  error?: string;
  disabled?: boolean;
  helperText?: string;
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  error,
  disabled,
  helperText,
}: FieldBase & {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted">{label}</label>
      <Select
        value={value}
        onChange={onChange}
        options={options}
        disabled={disabled}
        buttonClassName={`border ${
          error
            ? "border-err focus:border-err"
            : "border-border focus:border-accent-dim"
        }`}
      />
      {error && (
        <p className="text-[11px] text-err" role="alert">{error}</p>
      )}
      {helperText && !error && (
        <p className="text-[11px] text-muted/60">{helperText}</p>
      )}
    </div>
  );
}

export function ToggleField({
  label,
  checked,
  onChange,
  disabled,
  helperText,
}: FieldBase & {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className={`flex items-center gap-2.5 text-xs text-muted select-none ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => !disabled && onChange(!checked)}
          disabled={disabled}
          className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
            checked ? "bg-accent" : "bg-white/10"
          } ${disabled ? "cursor-not-allowed" : ""}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              checked ? "translate-x-4" : ""
            }`}
          />
        </button>
        {label}
      </label>
      {helperText && (
        <p className="text-[11px] text-muted/60 ml-[3.25rem]">{helperText}</p>
      )}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  error,
  disabled,
  helperText,
  type = "text",
}: FieldBase & {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted">{label}</label>
      <input
        type={type}
        className={`bg-surface text-foreground border rounded-md px-2.5 py-2 text-sm outline-none transition-colors ${
          error
            ? "border-err focus:border-err"
            : "border-border focus:border-accent-dim"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      {error && (
        <p className="text-[11px] text-err" role="alert">{error}</p>
      )}
      {helperText && !error && (
        <p className="text-[11px] text-muted/60">{helperText}</p>
      )}
    </div>
  );
}

export function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  displayValue,
  disabled,
  helperText,
}: FieldBase & {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  displayValue?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <label className="text-xs text-muted">{label}</label>
        {displayValue && <span className="text-xs text-muted font-mono">{displayValue}</span>}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={`w-full accent-accent ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        disabled={disabled}
      />
      {helperText && (
        <p className="text-[11px] text-muted/60">{helperText}</p>
      )}
    </div>
  );
}
