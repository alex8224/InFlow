export function MarkdownBlock({ markdown }: { markdown: string }) {
  return (
    <div className="prose prose-sm max-w-none">
      <p className="whitespace-pre-wrap">{markdown}</p>
    </div>
  );
}
