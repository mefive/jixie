import React, { useRef, useState, useCallback } from 'react';
import { observer as originalObserver } from 'mobx-react';

// Note: the original marginalia file also has two hooks, useLoaderErrorNotify/useLoaderSuccessNotify,
// which depend on antd's Modal/message/notification. fangtu doesn't use antd, so they weren't copied; implement notifications with Tailwind when needed.

/**
 * ### Replacement for `mobx-react`'s default `observer`
 *
 * Combines wrapping a component with `observer` and setting `displayName` into one step, reducing boilerplate
 * and making single-line exports convenient. The type definitions currently only support function components; extend if needed.
 *
 * @param component the function component to wrap with `observer`
 * @param displayName the component's display name
 * @returns the wrapped component
 */
export function observer(
  // When mobx-react wraps a generic function component, a strict props type conflicts with index signatures like antd's `data-${string}`
  component: React.FunctionComponent<any>,
  displayName: string,
) {
  const newComponent = component;
  newComponent.displayName = displayName;
  return originalObserver(newComponent) as any;
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
