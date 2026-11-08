import { type ReactNode, useEffect, useId, useLayoutEffect, useRef } from 'react';

/** A titled modal in the app's own style, on the native dialog. */
export function Dialog(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  wide?: boolean;
  /** Keeps one height whatever's inside, so it doesn't jump as content changes. */
  fixedHeight?: boolean;
  /** False while there's something to lose: a click outside no longer closes it. */
  dismissible?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);
  useScrollLock(props.open);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
      onClick={(e) =>
        e.target === e.currentTarget && props.dismissible !== false && props.onClose()
      }
      className={`rm-dialog card m-auto p-0 text-(--text-primary) ${
        props.wide ? 'w-[min(40rem,calc(100vw-2rem))]' : 'w-[min(26rem,calc(100vw-2rem))]'
      } ${props.fixedHeight ? 'h-[min(44rem,calc(100dvh-2rem))]' : ''}`}
    >
      {props.open && (
        <div className={`p-5 ${props.fixedHeight ? 'flex h-full flex-col' : ''}`}>
          <h2 id={titleId} className="mb-4 text-base font-semibold tracking-tight">
            {props.title}
          </h2>
          {props.children}
        </div>
      )}
    </dialog>
  );
}

/**
 * Holds the page still behind a modal and puts it back where it was after.
 * The body is pinned at its offset: hiding the root's overflow instead drops
 * the scroll position, as the root and body are the viewport's height.
 */
export function useScrollLock(locked: boolean) {
  // Before the dialog opens: focusing its first field would scroll the page.
  useLayoutEffect(() => {
    if (!locked) return;
    const body = document.body;
    const y = window.scrollY;
    const before = { position: body.style.position, top: body.style.top, width: body.style.width };
    Object.assign(body.style, { position: 'fixed', top: `-${y}px`, width: '100%' });
    return () => {
      Object.assign(body.style, before);
      window.scrollTo(0, y);
    };
  }, [locked]);
}
