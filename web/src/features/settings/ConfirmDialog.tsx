import { useEffect, useId, useRef } from 'react';
import { dangerButton, secondaryButton } from './SettingsControls';

/**
 * Asks before a destructive action, in the app's own style rather than the
 * browser's. A modal <dialog> keeps focus inside and closes on Escape;
 * focus starts on Cancel, so Enter doesn't confirm by accident.
 */
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    else if (!props.open && dialog.open) dialog.close();
  }, [props.open]);

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={props.message ? messageId : undefined}
      // Escape: let React's state close it.
      onCancel={(e) => {
        e.preventDefault();
        props.onCancel();
      }}
      // A click on the backdrop lands on the dialog itself.
      onClick={(e) => e.target === e.currentTarget && props.onCancel()}
      className="card m-auto w-[min(26rem,calc(100vw-2rem))] p-0 text-(--text-primary) shadow-[0_24px_64px_rgba(0,0,0,0.6)] backdrop:bg-black/60"
    >
      {props.open && (
        <div className="p-5">
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            {props.title}
          </h2>
          {props.message && (
            <p id={messageId} className="mt-1.5 text-sm text-(--text-secondary)">
              {props.message}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" autoFocus className={secondaryButton} onClick={props.onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className={dangerButton}
              disabled={props.busy}
              onClick={props.onConfirm}
            >
              {props.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
