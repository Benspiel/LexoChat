import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { Icon } from "./icons";

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- Button

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "soft" | "ghost";
  size?: "md" | "sm";
  block?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", block, loading, disabled, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("lx-btn", `lx-btn--${variant}`, size === "sm" && "lx-btn--sm", block && "lx-btn--block", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="lx-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------- TextField

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  hideLabel?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, hideLabel, id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={cx("lx-field", className)}>
      <label htmlFor={inputId} className={hideLabel ? "lx-sr-only" : "lx-label"}>
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        className="lx-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        {...rest}
      />
      {hint && (
        <div id={hintId} className="lx-hint">
          {hint}
        </div>
      )}
      {error && (
        <div id={errorId} className="lx-error">
          <Icon name="alert" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------- SelectField

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: { value: string; label: string }[];
  hint?: ReactNode;
}

export function SelectField({ label, options, hint, id, className, ...rest }: SelectFieldProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  return (
    <div className={cx("lx-field", className)}>
      <label htmlFor={selectId} className="lx-label">
        {label}
      </label>
      <select id={selectId} className="lx-select" aria-describedby={hintId} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && (
        <div id={hintId} className="lx-hint">
          {hint}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Toggle

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  const descId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={description ? descId : undefined}
      className="lx-toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="lx-toggle__track" aria-hidden="true">
        <span className="lx-toggle__thumb" />
      </span>
      <span className="lx-stack-sm" style={{ gap: 0 }}>
        <span className="lx-label">{label}</span>
        {description && (
          <span id={descId} className="lx-hint">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- Card, Badge, Notice

export function Card({ soft, className, children }: { soft?: boolean; className?: string; children: ReactNode }) {
  return <div className={cx("lx-card", soft && "lx-card--soft", className)}>{children}</div>;
}

export function Badge({ variant = "neutral", children }: { variant?: "neutral" | "outline" | "ink" | "accent"; children: ReactNode }) {
  return <span className={cx("lx-badge", `lx-badge--${variant}`)}>{children}</span>;
}

export function Notice({ kind = "info", children }: { kind?: "info" | "success" | "warning" | "error"; children: ReactNode }) {
  const icon = kind === "error" || kind === "warning" ? "alert" : kind === "success" ? "check" : "info";
  return (
    <div
      className={cx("lx-notice", kind === "error" && "lx-notice--error", kind === "warning" && "lx-notice--warning")}
      role={kind === "error" ? "alert" : "status"}
    >
      <Icon name={icon} />
      <div className="lx-grow">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Avatar

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  return (
    <span className="lx-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initials(name)}
    </span>
  );
}

// ---------------------------------------------------------------- EmptyState, Spinner

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="lx-empty">
      <h3>{title}</h3>
      {children && <p className="lx-muted-strong">{children}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label = "Wird geladen …" }: { label?: string }) {
  return (
    <span className="lx-row" role="status">
      <span className="lx-spinner" aria-hidden="true" />
      <span className="lx-muted">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------- Dialog (native <dialog>)

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** prevents closing with Esc (e.g. while a one-time password is shown) */
  persistent?: boolean;
}

export function Dialog({ open, title, onClose, children, footer, persistent }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="lx-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!persistent) onClose();
      }}
    >
      {open && (
        <div className="lx-dialog__inner">
          <div className="lx-spread">
            <h2 id={titleId}>{title}</h2>
            {!persistent && (
              <Button variant="ghost" size="sm" onClick={onClose} aria-label="Dialog schließen">
                <Icon name="x" />
              </Button>
            )}
          </div>
          {children}
          {footer && <div className="lx-dialog__footer">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
