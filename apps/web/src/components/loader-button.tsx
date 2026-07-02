import { App, Button, type ButtonProps } from 'antd';
import { useRef, useState } from 'react';
import { reactUtils, type LoaderModel } from '@src/lib';

// Async-action button: a thin antd Button wrapper that only adds behavior, never styling.
//   - with `action`: clicking runs it (e.g. a store method that wraps loader.run)
//   - with only `loader`: clicking runs loader.run(payload?.())
// It faithfully injects antd's `loading` (from the loader / an explicit override / the in-flight action)
// and debounces re-entry; everything visual (icon, type, size — including whether antd's loading spinner
// swaps an icon in place or inserts before the label) is antd's own behavior, decided by the caller's props.
// message/modal come from App.useApp() (antd 6 context) so the confirm dialog picks up the ink theme.
type LoaderRef = Pick<LoaderModel, 'loading' | 'run'>;

type LoaderButtonProps = Omit<ButtonProps, 'loading' | 'onClick'> & {
  loader?: LoaderRef;
  // Force the loading state from external state (e.g. a poller-driven backtest, not a LoaderModel).
  // OR-ed with the loader/internal-busy signal.
  loading?: boolean;
  action?: () => unknown | Promise<unknown>;
  payload?: () => unknown; // arg for the default loader.run, evaluated on click
  beforeRun?: () => boolean | Promise<boolean>; // gate: return false to abort silently (validation etc.)
  confirm?: string; // show a confirm dialog first; cancel aborts
  successMessage?: string;
  onSuccess?: () => void; // after success (and after the success toast)
  errorMessage?: string | false; // false = silent; string = that text; default = err.message
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

  return <Button {...rest} loading={loading} disabled={disabled} onClick={handleClick} />;
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
