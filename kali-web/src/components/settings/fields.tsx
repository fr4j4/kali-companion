// Shared form field primitives for settings sections.

import { type ReactNode } from "react";

export function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted">{label}</label>
      <select
        className="bg-surface text-foreground border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-accent-dim transition-colors"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </div>
  );
}

export function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 text-xs text-muted cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
          checked ? "bg-accent" : "bg-white/10"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </button>
      {label}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-muted">{label}</label>
      <input
        type="text"
        className="bg-surface text-foreground border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-accent-dim transition-colors"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
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
}: {
  label: string;
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
        className="w-full accent-accent"
      />
    </div>
  );
}