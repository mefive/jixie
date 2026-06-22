import React, { useRef, useState, useCallback } from 'react';
import { observer as originalObserver } from 'mobx-react';

// 注:marginalia 原文件还含 useLoaderErrorNotify/useLoaderSuccessNotify 两个 hook,
// 它们依赖 antd 的 Modal/message/notification。fangtu 不引 antd,故未拷;需要时自行用 Tailwind 实现提示。

/**
 * ### 替代`mobx-react`默认的`observer`
 *
 * 将使用`observer`包装组件和设置`displayName`合并在一起处理，减少模板代码，并方便使用单行语句导出。
 * 类型定义暂只支持函数组件，如果有需要再扩展。
 *
 * @param component 要使用`observer`包装的函数组件
 * @param displayName 组件的显示名称
 * @returns 包装后的组件
 */
export function observer(
  // 与 mobx-react 包装泛型函数组件时，用严格 props 类型会与 antd 等 `data-${string}` 等索引冲突
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
