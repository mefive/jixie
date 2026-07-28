import {
  Children,
  isValidElement,
  useEffect,
  useMemo,
  type ReactNode,
  type HTMLAttributes,
} from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { observer } from 'mobx-react';
import { useTranslation } from 'react-i18next';
import { Image } from 'antd';
import { XMarkdown, type ComponentProps } from '@ant-design/x-markdown';
import type { Locale } from '@jixie/shared';
import { localeStore } from '@src/i18n/locale-store';
import { PublicDocsHeader } from '@src/components/public-docs-header';
import {
  DEFAULT_HELP_SLUG,
  findHelpArticle,
  HELP_ARTICLES,
  HELP_GROUPS,
  type HelpArticle,
} from './articles';
import './help.css';

type Heading = {
  depth: 2 | 3;
  id: string;
  text: string;
};

export default observer(function HelpPage() {
  const { '*': slug } = useParams();
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
});

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
  const components = useMemo(
    () => ({
      h1: createHeading(1),
      h2: createHeading(2),
      h3: createHeading(3),
      a: HelpLink,
      img: HelpImage,
    }),
    [],
  );

  return (
    <XMarkdown
      className="jx-help-markdown"
      content={content}
      components={components}
      escapeRawHtml
      openLinksInNewTab={false}
    />
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
