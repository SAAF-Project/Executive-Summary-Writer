import { normalizeChatContent } from "@/lib/chat-content";
import { ChatMarkdown } from "./chat-markdown";

export function ChatMessageContent({ content, role }: { content: unknown; role: "assistant" | "user" }) {
  const normalized = normalizeChatContent(content);
  return <div className="chat-content">
    {normalized.before && <ChatMarkdown>{normalized.before}</ChatMarkdown>}
    {!!normalized.questions.length && <ol className="chat-questions" aria-label={role === "assistant" ? "Questions from the agent" : "Your message items"}>{normalized.questions.map((question, index) => <li key={index} value={question.number}>
      <ChatMarkdown>{question.text}</ChatMarkdown>
      {!!question.options.length && <ul className="chat-answer-options" aria-label="Answer options">{question.options.map((option, optionIndex) => <li key={optionIndex}><ChatMarkdown>{option}</ChatMarkdown></li>)}</ul>}
    </li>)}</ol>}
    {normalized.after && <ChatMarkdown>{normalized.after}</ChatMarkdown>}
  </div>;
}
