import {
  Children,
  isValidElement,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type HTMLAttributes,
} from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Image } from 'antd';
import { XMarkdown, type ComponentProps } from '@ant-design/x-markdown';
import Latex from '@ant-design/x-markdown/plugins/Latex';
import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-python';
import type { Locale } from '@jixie/shared';
import { localeStore } from '@src/i18n/locale-store';
import { PublicDocsHeader } from '@src/components/public-docs-header';
import { complex } from './complex';
import {
  DEFAULT_HELP_SLUG,
  findHelpArticle,
  HELP_ARTICLES,
  HELP_GROUPS,
  type HelpArticle,
} from './articles';
import './help.css';

export const Help = complex.component(() => {
  const store = complex.useStore();
  const slug = store.slug;
  const location = useLocation();
  const { t } = useTranslation('help');
  const locale = localeStore.locale;
  const article = findHelpArticle(slug);

  useEffect(() => {
    if (!article) {
      return;
    }
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) {
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    } else {
      window.scrollTo({ top: 0 });
    }
  }, [article, locale, location.hash]);

  if (!article) {
    return <Navigate to={`/help/${DEFAULT_HELP_SLUG}`} replace />;
  }

  const articleIndex = HELP_ARTICLES.indexOf(article);
  const previous = HELP_ARTICLES[articleIndex - 1];
  const next = HELP_ARTICLES[articleIndex + 1];
  const headings = extractHeadings(article.content[locale]);

  return (
    <div className="jx-help">
      <PublicDocsHeader current="help" />

      <div className="jx-help-layout">
        <ArticleNavigation article={article} locale={locale} mobile={false} />

        <main className="jx-help-main">
          <ArticleNavigation article={article} locale={locale} mobile />
          <div className="jx-help-breadcrumb">
            {t(`groups.${article.group}`)} <span aria-hidden="true">/</span> {article.title[locale]}
          </div>
          <p className="jx-help-summary">{article.summary[locale]}</p>
          <HelpMarkdown content={article.content[locale]} />
          <nav className="jx-help-pager" aria-label={t('articlePager')}>
            {previous ? (
              <ArticlePager article={previous} direction={t('previous')} locale={locale} />
            ) : (
              <span />
            )}
            {next ? (
              <ArticlePager article={next} direction={t('next')} locale={locale} />
            ) : (
              <span />
            )}
          </nav>
        </main>

        <aside className="jx-help-toc">
          <div className="jx-help-tocTitle">{t('onThisPage')}</div>
          {headings.map((heading) => (
            <a
              className={`jx-help-tocLink jx-help-tocLink--${heading.depth}`}
              href={`#${encodeURIComponent(heading.id)}`}
              key={heading.id}
            >
              {heading.text}
            </a>
          ))}
        </aside>
      </div>
    </div>
  );
}, 'Help');

// —— Subcomponents / helpers ——

type Heading = {
  depth: 2 | 3;
  id: string;
  text: string;
};

type HelpMarkdownSegment =
  | { kind: 'markdown'; content: string }
  | { kind: 'codeTabs'; typescript: string; python: string };

const helpMarkdownConfig = { extensions: Latex() };

function ArticleNavigation({
  article,
  locale,
  mobile,
}: {
  article: HelpArticle;
  locale: Locale;
  mobile: boolean;
}) {
  const { t } = useTranslation('help');
  const content = (
    <>
      {HELP_GROUPS.map((group) => (
        <div className="jx-help-navGroup" key={group}>
          <div className="jx-help-navGroupTitle">{t(`groups.${group}`)}</div>
          {HELP_ARTICLES.filter((item) => item.group === group).map((item) => (
            <Link
              className={
                item.slug === article.slug
                  ? 'jx-help-navLink jx-help-navLink--active'
                  : 'jx-help-navLink'
              }
              to={`/help/${item.slug}`}
              key={item.slug}
            >
              {item.title[locale]}
            </Link>
          ))}
        </div>
      ))}
    </>
  );

  if (mobile) {
    return (
      <details className="jx-help-mobileNav">
        <summary>{t('allArticles')}</summary>
        <div className="jx-help-mobileNavBody">{content}</div>
      </details>
    );
  }

  return (
    <nav className="jx-help-nav" aria-label={t('allArticles')}>
      <div className="jx-help-navTitle">{t('allArticles')}</div>
      {content}
    </nav>
  );
}

function ArticlePager({
  article,
  direction,
  locale,
}: {
  article: HelpArticle;
  direction: string;
  locale: Locale;
}) {
  return (
    <Link className="jx-help-pagerLink" to={`/help/${article.slug}`}>
      <span>{direction}</span>
      <strong>{article.title[locale]}</strong>
    </Link>
  );
}

function HelpMarkdown({ content }: { content: string }) {
  const segments = useMemo(() => splitCodeTabs(content), [content]);
  const components = useMemo(
    () => ({
      h1: createHeading(1),
      h2: createHeading(2),
      h3: createHeading(3),
      a: HelpLink,
      p: HelpParagraph,
      img: HelpImage,
      pre: HelpCodeBlock,
    }),
    [],
  );

  return (
    <div className="jx-help-markdown">
      {segments.map((segment, index) =>
        segment.kind === 'markdown' ? (
          <XMarkdown
            content={segment.content}
            config={helpMarkdownConfig}
            components={components}
            escapeRawHtml
            key={`markdown-${index}`}
            openLinksInNewTab={false}
          />
        ) : (
          <LanguageCodeTabs
            key={`code-tabs-${index}`}
            python={segment.python}
            typescript={segment.typescript}
          />
        ),
      )}
    </div>
  );
}

function HelpParagraph({
  domNode: _domNode,
  streamStatus: _streamStatus,
  children,
  ...props
}: ComponentProps) {
  const containsImage = Children.toArray(children).some(
    (child) => isValidElement(child) && child.type === HelpImage,
  );

  if (containsImage) {
    return <div {...(props as HTMLAttributes<HTMLDivElement>)}>{children}</div>;
  }

  return <p {...(props as HTMLAttributes<HTMLParagraphElement>)}>{children}</p>;
}

function HelpCodeBlock({
  domNode: _domNode,
  streamStatus: _streamStatus,
  children,
}: ComponentProps) {
  const code = Children.toArray(children).find(isValidElement);
  const className =
    code && isValidElement<{ className?: string }>(code) ? code.props.className : '';
  const language = normalizeCodeLanguage(className?.match(/language-([\w-]+)/)?.[1]);
  const value = reactNodeText(code ?? children).replace(/\n$/, '');
  return <HighlightedCode className="jx-help-codeBlock" language={language} value={value} />;
}

function LanguageCodeTabs({ typescript, python }: { typescript: string; python: string }) {
  const [language, setLanguage] = useState<'typescript' | 'python'>('typescript');
  return (
    <section className="jx-help-codeTabs" data-testid="help-code-tabs">
      <div className="jx-help-codeTabsBar" role="tablist" aria-label="Code language">
        <button
          aria-selected={language === 'typescript'}
          className={
            language === 'typescript'
              ? 'jx-help-codeTab jx-help-codeTab--active'
              : 'jx-help-codeTab'
          }
          onClick={() => setLanguage('typescript')}
          role="tab"
          type="button"
        >
          TypeScript
        </button>
        <button
          aria-selected={language === 'python'}
          className={
            language === 'python' ? 'jx-help-codeTab jx-help-codeTab--active' : 'jx-help-codeTab'
          }
          onClick={() => setLanguage('python')}
          role="tab"
          type="button"
        >
          Python
        </button>
      </div>
      <HighlightedCode
        className="jx-help-codeBlock jx-help-codeBlock--tabbed"
        language={language}
        value={language === 'typescript' ? typescript : python}
      />
    </section>
  );
}

function HighlightedCode({
  className,
  language,
  value,
}: {
  className: string;
  language: string;
  value: string;
}) {
  const grammar = Prism.languages[language] ?? Prism.languages.plain ?? Prism.languages.markup;
  const highlighted = Prism.highlight(value, grammar, language);
  return (
    <div className={className} data-code-language={language}>
      <pre>
        <code
          className={`language-${language}`}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}

function HelpImage({
  domNode: _domNode,
  streamStatus: _streamStatus,
  src = '',
  alt = '',
}: ComponentProps<{ src?: string; alt?: string }>) {
  return (
    <figure className="jx-help-figure">
      <Image src={src} alt={alt} preview={{ cover: false }} />
      {alt ? <figcaption>{alt}</figcaption> : null}
    </figure>
  );
}

function createHeading(level: 1 | 2 | 3) {
  return function HelpHeading({
    domNode: _domNode,
    streamStatus: _streamStatus,
    children,
    ...props
  }: ComponentProps) {
    const id = headingId(reactNodeText(children));
    const Tag = `h${level}` as 'h1' | 'h2' | 'h3';
    return (
      <Tag {...(props as HTMLAttributes<HTMLHeadingElement>)} id={id}>
        {children}
      </Tag>
    );
  };
}

function HelpLink({
  domNode: _domNode,
  streamStatus: _streamStatus,
  children,
  ...props
}: ComponentProps<{ href?: string }>) {
  const { href = '' } = props;
  const cleanProps = props as HTMLAttributes<HTMLAnchorElement>;
  if (href.startsWith('/help/')) {
    return (
      <Link {...cleanProps} to={href}>
        {children}
      </Link>
    );
  }
  const external = /^https?:\/\//.test(href);
  return (
    <a
      {...cleanProps}
      href={href}
      rel={external ? 'noreferrer' : undefined}
      target={external ? '_blank' : undefined}
    >
      {children}
    </a>
  );
}

function splitCodeTabs(markdown: string): HelpMarkdownSegment[] {
  const segments: HelpMarkdownSegment[] = [];
  const pattern =
    /:::code-tabs\s*\n```(?:typescript|ts)\s*\n([\s\S]*?)\n```\s*\n```(?:python|py)\s*\n([\s\S]*?)\n```\s*\n:::/g;
  let cursor = 0;
  for (const match of markdown.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ kind: 'markdown', content: markdown.slice(cursor, index) });
    }
    segments.push({ kind: 'codeTabs', typescript: match[1], python: match[2] });
    cursor = index + match[0].length;
  }
  if (cursor < markdown.length) {
    segments.push({ kind: 'markdown', content: markdown.slice(cursor) });
  }
  return segments.length > 0 ? segments : [{ kind: 'markdown', content: markdown }];
}

function normalizeCodeLanguage(language?: string): string {
  if (!language) {
    return 'text';
  }
  if (language === 'ts') {
    return 'typescript';
  }
  if (language === 'js') {
    return 'javascript';
  }
  if (language === 'py') {
    return 'python';
  }
  if (language === 'shell' || language === 'sh') {
    return 'bash';
  }
  return language;
}

function extractHeadings(markdown: string): Heading[] {
  const headings: Heading[] = [];
  for (const match of markdown.matchAll(/^(#{2,3})\s+(.+?)\s*#*\s*$/gm)) {
    const text = markdownText(match[2]);
    headings.push({
      depth: match[1].length as 2 | 3,
      id: headingId(text),
      text,
    });
  }
  return headings;
}

function markdownText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim();
}

function reactNodeText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') {
        return String(child);
      }
      return isValidElement<{ children?: ReactNode }>(child)
        ? reactNodeText(child.props.children)
        : '';
    })
    .join('');
}

function headingId(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}
