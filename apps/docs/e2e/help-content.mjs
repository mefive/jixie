import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LOCALES = ['zh', 'en'];
const IMAGE_PREFIX = '/docs/images/help/';

// Read the registry as syntax only: never execute Vite imports or application code.
function readRegistry(filename) {
  const source = ts.createSourceFile(
    filename,
    readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
  );
  const imports = new Map();
  let registry;
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.name) {
      imports.set(statement.importClause.name.text, statement.moduleSpecifier.text);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.name.getText(source) === 'HELP_ARTICLES') {
          registry = declaration.initializer;
        }
      }
    }
  }
  assert.ok(registry && ts.isArrayLiteralExpression(registry), 'missing HELP_ARTICLES registry');
  const property = (object, name) => {
    assert.ok(ts.isObjectLiteralExpression(object), `expected object for ${name}`);
    const entry = object.properties.find((item) => item.name?.getText(source) === name);
    assert.ok(entry && ts.isPropertyAssignment(entry), `missing registry field ${name}`);
    return entry.initializer;
  };
  return registry.elements.map((entry) => {
    const slug = property(entry, 'slug').text;
    const content = property(entry, 'content');
    return {
      slug,
      paths: Object.fromEntries(
        LOCALES.map((locale) => {
          const importName = property(content, locale).getText(source);
          const importPath = imports.get(importName);
          assert.equal(
            importPath,
            `@src/content/help/${locale}/${slug}.md?raw`,
            `wrong ${locale} import for ${slug}`,
          );
          return [locale, `${locale}/${slug}.md`];
        }),
      ),
    };
  });
}

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = resolve(directory, entry.name);
    return entry.isDirectory()
      ? markdownFiles(filename)
      : filename.endsWith('.md')
        ? [filename]
        : [];
  });
}

export function checkHelpContent(root = ROOT) {
  const contentRoot = resolve(root, 'apps/docs/src/content/help');
  const imageRoot = resolve(root, 'apps/docs/public/images/help');
  const articles = readRegistry(resolve(root, 'apps/docs/src/complex/help/articles.ts'));
  const slugs = articles.map((article) => article.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate registered article slug');
  assert.ok(slugs.length > 0, 'empty article registry');
  for (const locale of LOCALES) {
    const files = markdownFiles(resolve(contentRoot, locale))
      .map((filename) => relative(contentRoot, filename))
      .sort();
    assert.deepEqual(
      files,
      articles.map((article) => article.paths[locale]).sort(),
      `${locale} files differ from registry`,
    );
  }

  const manifest = JSON.parse(
    readFileSync(resolve(root, 'docs/design/user-guide-images.json'), 'utf8'),
  );
  const images = new Map(manifest.images.map((entry) => [entry.path, entry]));
  assert.equal(images.size, manifest.images.length, 'duplicate image manifest path');
  const references = new Map();
  let linkCount = 0;
  for (const article of articles) {
    article.locales = {};
    for (const locale of LOCALES) {
      const filename = article.paths[locale];
      const markdown = readFileSync(resolve(contentRoot, filename), 'utf8');
      const prose = markdown.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
      const title = /^# (.+)$/m.exec(prose)?.[1];
      assert.ok(title, `missing title: ${filename}`);
      const figures = [...prose.matchAll(/!\[([^\]\n]*)\]\(([^\s)]+)\)/g)].map((match) => ({
        alt: match[1],
        src: match[2],
      }));
      const links = [...prose.matchAll(/(?<!!)\[[^\]\n]*\]\(([^\s)]+)\)/g)].map(
        (match) => match[1],
      );
      for (const href of links) {
        if (/^\/(?:docs\/)?help\//.test(href)) {
          const slug = new URL(href, 'https://help.invalid').pathname.replace(
            /^\/(?:docs\/)?help\//,
            '',
          );
          assert.ok(slugs.includes(slug), `unknown help link ${href} in ${filename}`);
          linkCount += 1;
        }
      }
      for (const figure of figures) {
        assert.ok(
          figure.src.startsWith(IMAGE_PREFIX),
          `unexpected image URL in ${filename}: ${figure.src}`,
        );
        const path = figure.src.slice(IMAGE_PREFIX.length);
        const entry = images.get(path);
        assert.ok(entry, `unlisted image ${path} in ${filename}`);
        if (!references.has(path)) {
          references.set(path, new Set());
        }
        references.get(path).add(filename);
        if (entry.disposition === 'recaptured') {
          assert.ok(path.startsWith(`${locale}/`), `wrong image locale in ${filename}: ${path}`);
        }
        if (['historical-illustration', 'historical-evidence'].includes(entry.disposition)) {
          const prefix = locale === 'zh' ? '历史中文界面示例：' : 'Historical Chinese UI example:';
          assert.ok(
            figure.alt.startsWith(prefix),
            `missing historical caption in ${filename}: ${path}`,
          );
        }
      }
      article.locales[locale] = { title, figures, links };
    }
    const normalized = (locale) =>
      article.locales[locale].figures.map((figure) =>
        figure.src.replace(/\/help\/(zh|en)\//, '/help/'),
      );
    assert.deepEqual(
      normalized('zh'),
      normalized('en'),
      `bilingual figure order differs: ${article.slug}`,
    );
  }

  const dispositions = new Set([
    'recaptured',
    'historical-illustration',
    'historical-evidence',
    'retained-interface',
    'retired',
  ]);
  let evidenceCount = 0;
  for (const entry of images.values()) {
    assert.ok(/^(zh|en)\/[\w/-]+\.png$/.test(entry.path), `invalid image path ${entry.path}`);
    assert.ok(dispositions.has(entry.disposition), `unknown disposition ${entry.disposition}`);
    const filename = resolve(imageRoot, entry.path);
    const actualArticles = [...(references.get(entry.path) ?? [])].sort();
    assert.deepEqual(entry.articles, actualArticles, `stale article references for ${entry.path}`);
    if (entry.disposition === 'retired') {
      assert.equal(existsSync(filename), false, `retired image still exists: ${entry.path}`);
      assert.equal(actualArticles.length, 0, `retired image still referenced: ${entry.path}`);
      continue;
    }
    assert.ok(actualArticles.length > 0, `unreferenced manifest image ${entry.path}`);
    const bytes = readFileSync(filename);
    assert.equal(
      bytes.subarray(0, 8).toString('hex'),
      '89504e470d0a1a0a',
      `invalid PNG ${entry.path}`,
    );
    assert.ok(
      bytes.readUInt32BE(16) >= 100 && bytes.readUInt32BE(20) >= 100,
      `undersized PNG ${entry.path}`,
    );
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash, entry.sha256, `image hash mismatch: ${entry.path}`);
    if (entry.disposition === 'historical-evidence') {
      assert.equal(hash, entry.originalSha256, `learning evidence changed: ${entry.path}`);
      evidenceCount += 1;
    }
    if (entry.disposition === 'recaptured') {
      const pairedPath = entry.path.replace(
        /^(zh|en)\//,
        entry.path.startsWith('zh/') ? 'en/' : 'zh/',
      );
      assert.equal(
        images.get(pairedPath)?.disposition,
        'recaptured',
        `missing current locale pair: ${entry.path}`,
      );
    }
  }
  assert.equal(evidenceCount, 29, 'the 29 original learning evidence images must remain tracked');
  return {
    articles,
    summary: {
      articlesPerLocale: articles.length,
      internalLinks: linkCount,
      referencedImages: references.size,
      learningEvidence: evidenceCount,
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('[help-content]', checkHelpContent().summary);
}
