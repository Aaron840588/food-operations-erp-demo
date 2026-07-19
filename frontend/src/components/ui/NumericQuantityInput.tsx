import { Minus, Plus } from "lucide-react";

type NumericQuantityInputProps = {
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
};

function clamp(value: number, min: number, max?: number) {
  return Math.min(Math.max(value, min), max ?? Number.POSITIVE_INFINITY);
}

export function NumericQuantityInput({
  value,
  onChange,
  label,
  min = 0,
  max,
  step = 1,
  disabled = false,
  className = "",
  inputClassName = "",
}: NumericQuantityInputProps) {
  const update = (nextValue: number) => onChange(clamp(nextValue, min, max));

  return (
    <div className={`inline-flex min-w-0 items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={() => update(value - step)}
        disabled={disabled || value <= min}
        aria-label={`Decrease ${label}`}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-45"
      >
        <Minus size={16} strokeWidth={2.5} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => update(Number(event.target.value) || 0)}
        className={`quantity-input h-10 w-20 min-w-20 rounded-xl border border-[#dfd5c6] bg-[#fbf8f2] px-2 text-center font-mono text-sm font-black tabular-nums text-slate-900 ${inputClassName}`}
      />
      <button
        type="button"
        onClick={() => update(value + step)}
        disabled={disabled || (max !== undefined && value >= max)}
        aria-label={`Increase ${label}`}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-45"
      >
        <Plus size={16} strokeWidth={2.5} />
      </button>
    </div>
  );
}
