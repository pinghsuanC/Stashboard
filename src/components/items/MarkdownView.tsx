import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

// `remark-breaks`: a newline shows as one, as typed. Prompts are templates
// ("Diff:\n{{diff}}"), and standard Markdown would join those lines.
const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

// Links in user content open in a new tab and carry no referrer. Raw HTML in
// the Markdown is never rendered (no `rehype-raw`), and react-markdown's
// default `urlTransform` empties `javascript:` and other unsafe URLs; such a
// link stays text, since `href=""` would open this page again.
const COMPONENTS: Components = {
  a: ({ href, title, children }) =>
    href ? (
      <a href={href} title={title} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span title={title}>{children}</span>
    ),
};

// An image loads with no click, sending whatever is in its address. A model's
// answer can be steered by the code it read, so that address could carry a
// secret from the snippet. Only what the user wrote may load one.
const COMPONENTS_WITHOUT_IMAGES: Components = {
  ...COMPONENTS,
  img: ({ alt }) => <span>{alt}</span>,
};

interface MarkdownViewProps {
  value: string;
  /** For markdown the user wrote. Off by default, so a model's answer can't forget it. */
  allowImages?: boolean;
}

/**
 * Markdown that isn't ours to trust, such as an item's content or a model's
 * answer, rendered as GitHub Flavored Markdown and styled by the
 * `.markdown-preview` rules in globals.css.
 */
export const MarkdownView = ({ value, allowImages = false }: MarkdownViewProps) => (
  <div className="markdown-preview">
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={allowImages ? COMPONENTS : COMPONENTS_WITHOUT_IMAGES}>
      {value}
    </ReactMarkdown>
  </div>
);
