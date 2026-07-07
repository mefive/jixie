import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconProp } from '@fortawesome/fontawesome-svg-core';
import classNames from 'classnames';
import './placeholder.css';

// Centered icon + text filler for loading / empty / error states — the "loading ? spinner : content"
// block reused across pages (factor analysis, stock screener, ...). `spin` animates the icon (loading); `error` tints red.
// Richer than a bare antd <Spin>: it carries a FontAwesome icon + a line of explanatory text.
export function Placeholder({
  text,
  icon,
  spin,
  error,
}: {
  text: string;
  icon: IconProp;
  spin?: boolean;
  error?: boolean;
}) {
  return (
    <div className={classNames('jx-placeholder', { 'jx-placeholder--error': error })}>
      <FontAwesomeIcon icon={icon} spin={spin} />
      <span>{text}</span>
    </div>
  );
}
