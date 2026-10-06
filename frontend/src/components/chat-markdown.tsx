import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Shared presentation of agent and user messages, including saved conversations. */
export function ChatMarkdown({ children }: { children: string }) {
  return <div className="chat-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    h1: ({ children }) => <h3>{children}</h3>,
    h2: ({ children }) => <h3>{children}</h3>,
    h3: ({ children }) => <h3>{children}</h3>,
    a: ({ children, href }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
    // Messages do not fetch remote images or execute model-provided HTML.
    img: ({ alt }) => alt ? <span>{alt}</span> : null,
    table: ({ children }) => <div className="chat-table-scroll" role="region" aria-label="Scrollable message table" tabIndex={0}><table>{children}</table></div>,
  }}>{children}</Markdown></div>;
}
