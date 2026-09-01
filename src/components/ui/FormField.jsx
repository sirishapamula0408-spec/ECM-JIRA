import { useId } from 'react'

/**
 * FormField — label + control + help/error, the form unit of the design
 * system (JL-439).
 *
 * It renders the shared `.field*` classes from styles/shared.css rather than
 * carrying styles of its own, so a hand-rolled `<div className="field">` and a
 * <FormField> look identical. That matters: ~18 pages already write their own
 * field markup, and they can adopt the classes before they adopt the component.
 *
 * The wiring is the reason to prefer the component. It generates an id, points
 * `htmlFor` at the control, and links help and error text through
 * `aria-describedby` — three things every hand-rolled field in this codebase
 * currently gets wrong. `children` is called with the props the control needs.
 *
 *   <FormField label="Project name" help="Shown in the sidebar">
 *     {(p) => <input {...p} value={name} onChange={…} />}
 *   </FormField>
 *
 * A plain node also works; it just does not get the wiring.
 */
export function FormField({ label, help, error, required = false, children, className = '' }) {
  const id = useId()
  const helpId = `${id}-help`
  const errorId = `${id}-error`

  const describedBy = [help ? helpId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ')

  const controlProps = {
    id,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': error ? true : undefined,
    required: required || undefined,
  }

  return (
    <div className={`field ${className}`.trim()}>
      {label != null && (
        <label className="field-label" htmlFor={id}>
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </label>
      )}
      {typeof children === 'function' ? children(controlProps) : children}
      {help != null && help !== '' && (
        <p className="field-help" id={helpId}>{help}</p>
      )}
      {error != null && error !== '' && (
        <p className="field-error" id={errorId} role="alert">{error}</p>
      )}
    </div>
  )
}
