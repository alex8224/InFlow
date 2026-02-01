import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';
import 'prismjs/themes/prism.css';
import * as PrismNS from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-yaml';

const Prism: any = (PrismNS as any).default ?? PrismNS;

import { cn } from '../../lib/cn';

type MermaidRenderResult = { svg: string };

type HighlightResult = { html: string; language: string };

function normalizeLanguage(lang?: string) {
  const l = (lang || '').toLowerCase();
  if (l === 'py') return 'python';
  if (l === 'js') return 'javascript';
  if (l === 'ts') return 'typescript';
  if (!l) return 'text';
  return l;
}

function highlightSync(code: string, lang?: string): HighlightResult {
  const language = normalizeLanguage(lang);
  const grammar = Prism.languages?.[language] || Prism.languages?.clike || Prism.languages?.markup;
  if (!grammar) {
    return { html: code, language: 'text' };
  }
  const html = Prism.highlight(code, grammar, language);
  return { html, language };
}

let mermaidInitPromise: Promise<void> | null = null;

async function ensureMermaidInitialized() {
  if (!mermaidInitPromise) {
    mermaidInitPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
      });
    });
  }
  await mermaidInitPromise;
}

function CodeFence({ language, code }: { language?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const hl = useMemo(() => {
    try {
      return highlightSync(code, language);
    } catch {
      return null;
    }
  }, [code, language]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 900);
    } catch {
      // ignore
    }
  };

  return (
    <div className="code-fence group relative rounded-xl border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b">
        <div className="text-[9px] font-black uppercase tracking-[0.28em]">
          {normalizeLanguage(language)}
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="h-7 w-7 rounded-lg border transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100"
          title="Copy"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <pre className={cn('m-0 p-3 overflow-auto text-[12px] leading-relaxed', hl ? `language-${hl.language}` : '', 'not-prose')}>
        {hl ? (
          <code
            className={cn('font-mono language-' + hl.language)}
            dangerouslySetInnerHTML={{ __html: hl.html }}
          />
        ) : (
          <code className="font-mono">{code}</code>
        )}
      </pre>
    </div>
  );
}

function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useMemo(() => `mmd_${Date.now()}_${Math.random().toString(16).slice(2)}`, []);
  const renderSeqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const seq = (renderSeqRef.current += 1);
    setError(null);

    // Streaming markdown can update the same mermaid fence many times.
    // Debounce rendering to avoid constant re-render/flicker and heavy layout thrash.
    const timer = setTimeout(() => {
      (async () => {
        await ensureMermaidInitialized();
        const { default: mermaid } = await import('mermaid');
        const res = (await mermaid.render(id, code)) as unknown as MermaidRenderResult;
        if (cancelled) return;
        if (seq !== renderSeqRef.current) return;
        setSvg(res.svg);
      })().catch((e: any) => {
        if (cancelled) return;
        if (seq !== renderSeqRef.current) return;
        setError(e?.message || String(e));
      });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, id]);

  if (error && !svg) {
    return <CodeFence language="mermaid" code={code} />;
  }

  if (!svg) {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-[11px] text-muted-foreground font-bold">
        Rendering diagram...
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-background/60 overflow-hidden">
      <div className="p-3 overflow-auto" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}

export function RichMarkdown({ markdown, className }: { markdown: string; className?: string }) {
  return (
    <div className={cn('prose prose-sm dark:prose-invert max-w-none', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Block code: react-markdown renders ``` fences as <pre><code ...>...</code></pre>
          // We render the whole block at the <pre> level to avoid invalid nesting.
          pre(props) {
            const child: any = (props as any).children;
            const codeEl = Array.isArray(child) ? child[0] : child;
            const codeProps = codeEl?.props ?? {};
            const raw = Array.isArray(codeProps.children)
              ? codeProps.children.join('')
              : String(codeProps.children ?? '');
            const code = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
            const cls = String(codeProps.className ?? '');
            const lang = cls.match(/language-(\w+)/)?.[1];

            if (lang?.toLowerCase() === 'mermaid') {
              return <MermaidBlock code={code} />;
            }

            return <CodeFence language={lang} code={code} />;
          },

          // Inline code: keep it inline-only.
          code(props) {
            const { className, children } = props as any;
            const raw = String(children ?? '');
            const code = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
            return (
              <code className={cn('px-1 py-0.5 rounded bg-muted/40 border border-border/40 font-mono', className)}>
                {code}
              </code>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
