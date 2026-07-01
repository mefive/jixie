import { App, Button, type ButtonProps } from 'antd';
import { useRef, useState, type ReactNode } from 'react';
import classNames from 'classnames';
import { reactUtils, type LoaderModel } from '@src/lib';
import './loader-button.css';

// Async-action button: in-flight double-click guard + loading state + success/error toast in one place.
//   - with `action`: clicking runs it (e.g. a store method that wraps loader.run)
//   - with only `loader`: clicking runs loader.run(payload?.())
// `loader` (when given) also drives the spinner reactively; otherwise an internal busy flag does.
//
// Loading spinner: only passed through to antd when the button HAS an icon — antd swaps that icon slot
// to a spinner in place (stable, no width change). An icon-less button would make antd INSERT a spinner
// before the label, shoving it sideways — so we don't show a spinner there at all (give the button an
// icon if you want in-button loading feedback). Either way `--busy` + the busyRef guard block re-clicks.
//
// message/modal come from App.useApp() (antd 6 context) so the confirm dialog picks up the ink theme
// rather than the default antd blue — main.tsx wraps the tree in <App> for this.
type LoaderRef = Pick<LoaderModel, 'loading' | 'run'>;

type LoaderButtonProps = Omit<ButtonProps, 'loading' | 'onClick'> & {
  loader?: LoaderRef;
  // Force the loading visual from external state (e.g. a poller-driven backtest, not a LoaderModel).
  // OR-ed with the loader/internal-busy signal.
  loading?: boolean;
  action?: () => unknown | Promise<unknown>;
  payload?: () => unknown; // arg for the default loader.run, evaluated on click
  beforeRun?: () => boolean | Promise<boolean>; // gate: return false to abort silently (validation etc.)
  confirm?: string; // show a confirm dialog first; cancel aborts
  successMessage?: string;
  onSuccess?: () => void; // after success (and after the success toast)
  errorMessage?: string | false; // false = silent; string = that text; default = err.message
  children?: ReactNode;
};

export const LoaderButton = reactUtils.observer((props: LoaderButtonProps) => {
  const {
    loader,
    loading: loadingProp,
    action,
    payload,
    beforeRun,
    confirm,
    successMessage,
    onSuccess,
    errorMessage,
    disabled,
    className,
    children,
    ...rest
  } = props;

  const { message, modal } = App.useApp();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // synchronous re-entrancy guard, covers the whole beforeRun+confirm+action span
  const loading = (loadingProp ?? false) || (loader?.loading ?? false) || busy;

  const handleClick = async () => {
    if (busyRef.current || loading || disabled) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (beforeRun && !(await beforeRun())) return; // gate failed: abort silently
      if (confirm && !(await confirmModal(modal, confirm))) return; // user cancelled
      if (action) await action();
      else if (loader) await loader.run(payload?.());
      if (successMessage) message.success(successMessage);
      onSuccess?.();
    } catch (err) {
      if (errorMessage === false) return;
      message.error(errorMessage || errMsg(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // Spinner only when there's an icon to swap in place — see the note above.
  const hasIcon = rest.icon != null;

  return (
    <Button
      {...rest}
      loading={hasIcon ? loading : undefined}
      disabled={disabled}
      onClick={handleClick}
      className={classNames('jx-loaderBtn', className, { 'jx-loaderBtn--busy': loading })}
    >
      {children}
    </Button>
  );
}, 'LoaderButton');

// —— helper functions ——
type ModalApi = ReturnType<typeof App.useApp>['modal'];

function confirmModal(modal: ModalApi, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    modal.confirm({
      title: '确认',
      content,
      okText: '确认',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
