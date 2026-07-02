import React, { useRef, useState, useCallback } from 'react';
import { observer as originalObserver } from 'mobx-react';

// Note: the original marginalia file also contains two hooks, useLoaderErrorNotify/useLoaderSuccessNotify,
// which depend on antd's Modal/message/notification. fangtu does not use antd, so they were not copied; implement notifications with Tailwind yourself when needed.

/**
 * ### A replacement for `mobx-react`'s default `observer`
 *
 * Combines wrapping a component with `observer` and setting `displayName` into one step, reducing boilerplate and making single-line export convenient.
 * The type definitions only support function components for now; extend as needed.
 *
 * @param component the function component to wrap with `observer`
 * @param displayName the component's display name
 * @returns the wrapped component
 */
export function observer<C extends React.FunctionComponent<any>>(
  // Param stays `FunctionComponent<any>` so a strict props type doesn't conflict with index signatures
  // like antd's `data-${string}`. But we return the *same* component type `C` (not `any`), so the wrapped
  // component keeps its props type — JSX callers get prop-checking and hover types instead of `any`.
  component: C,
  displayName: string,
): C {
  const newComponent = component;
  newComponent.displayName = displayName;
  return originalObserver(newComponent) as unknown as C;
}

export function observerWithForwardedRef<
  T,
  P,
  C extends React.ForwardRefRenderFunction<T, React.PropsWithoutRef<P>>,
>(component: C, displayName: string) {
  const newComponent = component;
  newComponent.displayName = displayName;
  return originalObserver(React.forwardRef(newComponent));
}

export function useUncontrolledProp<T = string>(
  value: T,
  defaultValue: T,
  onChange: (newValue: T, ...args: any[]) => void,
  forceUpdateIfNoChange?: boolean,
): [T, (newValue: T, ...args: any[]) => void] {
  const [, forceUpdate] = useState(null);
  const uncontrolledRef = useRef(false);
  uncontrolledRef.current = value === undefined;
  const uncontrolledValueRef = useRef(defaultValue);
  const realValue = uncontrolledRef.current ? uncontrolledValueRef.current : value;
  const realOnChange = useCallback(
    (newValue: T, ...args: any[]) => {
      uncontrolledValueRef.current = newValue;
      if (newValue !== realValue) {
        onChange?.(newValue, ...args);
      }
      if (uncontrolledRef.current || (forceUpdateIfNoChange && newValue === realValue)) {
        forceUpdate({});
      }
    },
    [onChange, realValue, forceUpdateIfNoChange],
  );
  return [realValue, realOnChange];
}

export function usePropsRef<T>(props: T) {
  const propsRef = useRef<T>(null);
  propsRef.current = props;
  return propsRef;
}
