import { FormField } from './FormField'

/**
 * Input / Textarea / Select — the three form controls (JL-439).
 *
 * These are native elements, not MUI TextFields. The global
 * `input, select, textarea` rule in styles/shared.css already carries the whole
 * contract (40px, radius 6, --jira-border-strong, brand-blue focus ring), so a
 * native control here and a native control in a page stylesheet are the same
 * control. Routing these through MUI would have given two different-looking
 * inputs depending on which one a page happened to reach for — which is the
 * inconsistency this epic is about.
 *
 * Each composes FormField, so label association, help text and error wiring
 * come for free. Pass `label={undefined}` for a bare control (a search box in a
 * toolbar, say) and it renders the element alone.
 */
function withField({ label, help, error, required, fieldClassName, children }) {
  if (label == null && help == null && error == null) {
    return children({})
  }
  return (
    <FormField
      label={label}
      help={help}
      error={error}
      required={required}
      className={fieldClassName}
    >
      {children}
    </FormField>
  )
}

export function Input({ label, help, error, required, fieldClassName, className = '', ...rest }) {
  return withField({
    label,
    help,
    error,
    required,
    fieldClassName,
    children: (p) => (
      <input
        {...p}
        className={`ds-input ${error ? 'ds-input--error' : ''} ${className}`.trim()}
        {...rest}
      />
    ),
  })
}

export function Textarea({ label, help, error, required, fieldClassName, className = '', rows = 4, ...rest }) {
  return withField({
    label,
    help,
    error,
    required,
    fieldClassName,
    children: (p) => (
      <textarea
        {...p}
        rows={rows}
        className={`ds-textarea ${error ? 'ds-input--error' : ''} ${className}`.trim()}
        {...rest}
      />
    ),
  })
}

/**
 * `options` accepts strings or `{ value, label, disabled }`. A string is the
 * common case in this codebase (statuses, priorities, issue types all come from
 * src/constants.js as string arrays) and writing `{value: s, label: s}` at every
 * call site is noise.
 */
export function Select({
  label,
  help,
  error,
  required,
  fieldClassName,
  className = '',
  options = [],
  placeholder,
  children,
  ...rest
}) {
  const normalised = options.map((o) =>
    typeof o === 'string' ? { value: o, label: o } : o,
  )
  return withField({
    label,
    help,
    error,
    required,
    fieldClassName,
    children: (p) => (
      <select
        {...p}
        className={`ds-select ${error ? 'ds-input--error' : ''} ${className}`.trim()}
        {...rest}
      >
        {placeholder != null && <option value="">{placeholder}</option>}
        {normalised.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
    ),
  })
}
