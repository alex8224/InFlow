import { ContentBlock } from '../../core/types';
import { MarkdownBlock } from './MarkdownBlock';
import { CodeBlock } from './CodeBlock';

export function ContentBlocks({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'markdown':
            return <MarkdownBlock key={index} markdown={block.markdown} />;
          case 'code':
            return <CodeBlock key={index} language={block.language} code={block.code} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
