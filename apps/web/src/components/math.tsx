import { useEffect, useRef } from 'react';
import classNames from 'classnames';

/**
 * A KaTeX-rendered math span/block for assistant markdown (\( inline \) and \[ display \]).
 *
 * KaTeX's engine (~280KB) is dynamically imported on first render, so a conversation with no formulas
 * never downloads it and it stays out of the main bundle. We render via a ref + katex.render (not
 * renderToString + dangerouslySetInnerHTML) so the untrusted TeX is escaped by KaTeX itself. Until the
 * chunk lands — or if it fails / the TeX is malformed (throwOnError:false) — the raw source shows.
 */
export function Math({ tex, display }: { tex: string; display?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let cancelled = false;
    // Engine + stylesheet both lazy — the .css (and the fonts it references) ride the same on-demand chunk.
    void Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([katex]) => {
      if (cancelled || !ref.current) {
        return;
      }
      katex.default.render(tex, ref.current, {
        displayMode: !!display,
        throwOnError: false,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [tex, display]);

  return (
    <span ref={ref} className={classNames('jx-md-math', { 'jx-md-math--block': display })}>
      {tex}
    </span>
  );
}
