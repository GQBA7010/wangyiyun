interface ToggleProps {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}

export function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300 disabled:opacity-50 ${
        checked
          ? 'bg-gradient-to-r from-brand-500 to-accent-500'
          : 'bg-white/10'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
