// Drop-in replacement for our old TextBlock in chat turns.
//
// Wires react-markdown + remark-gfm + rehype-sanitize with our own
// component overrides for code (charts!), tables, and basic block tags.
// Scoped Tailwind classes pick up our token colours so it follows the
// active theme automatically.

import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

import { MarkdownCode } from './MarkdownCode';
import {
  MarkdownTable,
  TableHead,
  TableCell,
  TableRow,
  TableHeader,
  TableBody,
} from './MarkdownTable';

// Allow the extra attributes our chart blocks need on <code>.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), ['className']],
    span: [...(defaultSchema.attributes?.span || []), ['className']],
  },
};

export function MarkdownContent({ text, id, complete = true }) {
  const components = useMemo(() => ({
    code: (props) => <MarkdownCode id={id} complete={complete} {...props} />,
    table: (props) => <MarkdownTable {...props} />,
    thead: TableHeader,
    tbody: TableBody,
    tr: TableRow,
    th: TableHead,
    td: TableCell,
    // Inline body styling — keep paragraphs compact and consistent
    // with the rest of the chat column.
    p: (props) => (
      <p className="font-body text-body text-ink-2 my-0 first:mt-0 last:mb-0" {...props} />
    ),
    h1: (props) => (
      <h1 className="font-display text-[20px] font-semibold text-ink mt-4 mb-2" {...props} />
    ),
    h2: (props) => (
      <h2 className="font-display text-[17px] font-semibold text-ink mt-4 mb-2" {...props} />
    ),
    h3: (props) => (
      <h3 className="font-display text-[14px] font-semibold uppercase tracking-wider text-ink-3 mt-3 mb-1" {...props} />
    ),
    ul: (props) => (
      <ul className="list-disc pl-5 my-2 text-body text-ink-2 space-y-1" {...props} />
    ),
    ol: (props) => (
      <ol className="list-decimal pl-5 my-2 text-body text-ink-2 space-y-1" {...props} />
    ),
    li: (props) => <li className="text-ink-2 marker:text-ink-4" {...props} />,
    a: (props) => (
      <a className="text-accent underline-offset-2 hover:underline" target="_blank" rel="noreferrer" {...props} />
    ),
    blockquote: (props) => (
      <blockquote className="border-l-2 border-line pl-3 italic text-ink-3 my-2" {...props} />
    ),
    strong: (props) => <strong className="font-semibold text-ink" {...props} />,
    em: (props) => <em className="italic text-ink-2" {...props} />,
    hr: () => <hr className="my-3 border-t border-line" />,
    pre: (props) => <pre className="my-2 overflow-x-auto" {...props} />,
  }), [id, complete]);

  return (
    <div className="markdown-content space-y-2 break-words text-body text-ink-2">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={components}
      >
        {text || ''}
      </Markdown>
    </div>
  );
}
