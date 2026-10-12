import { type ReactNode, useEffect, useId, useRef } from 'react';
import { dangerButton, secondaryButton } from '../features/settings/SettingsControls';

/**
 * Asks before something that can't be undone, in the app's own style. The
 * native dialog keeps focus inside, closes on Escape and dims the page.
 */
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Escape closes the dialog itself; keep the open state in step.
      onCancel={(e) => {
        e.preventDefault();
        props.onCancel();
      }}
      // A click on the dimmed backdrop lands on the dialog element itself.
      onClick={(e) => e.target === e.currentTarget && props.onCancel()}
      className="rm-dialog card m-auto w-[min(26rem,calc(100vw-2rem))] p-0 text-(--text-primary)"
    >
      <div className="p-5">
        <h2 id={titleId} className="text-base font-semibold tracking-tight">
          {props.title}
        </h2>
        {props.children && (
          <div className="mt-1.5 text-sm text-(--text-secondary)">{props.children}</div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={props.onCancel} autoFocus>
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
    </dialog>
  );
}
