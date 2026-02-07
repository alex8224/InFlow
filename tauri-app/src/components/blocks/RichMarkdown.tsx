import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Copy, Check, Maximize, X } from 'lucide-react';
import 'prismjs/themes/prism.css';
import 'katex/dist/katex.min.css';
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
import { readLocalImageDataUrl } from '../../integrations/tauri/api';

type MermaidRenderResult = { svg: string };

type HighlightResult = { html: string; language: string };

function isWindowsAbsolutePath(input: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(input);
}

function isUncPath(input: string): boolean {
  return /^\\\\[^\\/]+[\\/][^\\/]+/.test(input);
}

function isLikelyAbsoluteLocalPath(input: string): boolean {
  return isWindowsAbsolutePath(input) || isUncPath(input) || input.startsWith('/');
}

function normalizeLocalPath(inputPath: string): string {
  let path = inputPath.trim();
  if (!path) return '';

  // Common markdown-escape loss case from agent-browser paths.
  path = path.replace(/([^\\/])\.agent-browser([\\/]|$)/i, '$1\\.agent-browser$2');

  if (isWindowsAbsolutePath(path)) {
    path = path.replace(/\\/g, '/');
    path = path.replace(/^([a-zA-Z]):(?!\/)/, '$1:/');
    return path;
  }

  if (isUncPath(path)) {
    return `//${path.replace(/^\\\\/, '').replace(/\\/g, '/')}`;
  }

  if (path.startsWith('/')) {
    return path.replace(/\\/g, '/');
  }

  return path;
}

function toAssetUrl(localPath: string): string {
  const normalized = normalizeLocalPath(localPath);
  if (!normalized) return '';
  try {
    const converted = convertFileSrc(normalized);
    if (!converted || converted === normalized) return '';
    return converted;
  } catch {
    return '';
  }
}

function normalizeFileUrlToPath(fileUrl: string): string | null {
  try {
    const parsed = new URL(fileUrl);
    if (parsed.protocol !== 'file:') return null;
    let path = decodeURIComponent(parsed.pathname || '');
    if (parsed.host) {
      const host = decodeURIComponent(parsed.host);
      path = `\\\\${host}${path.replace(/\//g, '\\')}`;
    }
    if (/^\/[a-zA-Z]:\//.test(path)) {
      path = path.slice(1);
    }
    return path.replace(/\//g, '\\');
  } catch {
    return null;
  }
}

function isBlockedScheme(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:text/html');
}

function hasImageExtension(input: string): boolean {
  const base = input.split('#')[0]?.split('?')[0] ?? input;
  const lower = base.toLowerCase();
  return (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.bmp') ||
    lower.endsWith('.svg')
  );
}

function hasUrlScheme(input: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input);
}

function isLikelyRelativeLocalImagePath(input: string): boolean {
  const s = input.trim();
  if (!s) return false;
  if (hasUrlScheme(s)) return false;
  if (s.startsWith('//')) return false;
  if (s.startsWith('#')) return false;
  if (s.startsWith('?')) return false;
  if (s.startsWith('./') || s.startsWith('../') || s.startsWith('.\\') || s.startsWith('..\\')) return true;
  if (s.includes('\\')) return true;
  return hasImageExtension(s);
}

function resolveLocalAwareUrl(rawUrl?: string): string {
  const url = String(rawUrl ?? '').trim();
  if (!url) return '';
  if (isBlockedScheme(url)) return '';

  const lower = url.toLowerCase();
  if (lower.startsWith('file://')) {
    const filePath = normalizeFileUrlToPath(url);
    if (!filePath) return '';
    const assetUrl = toAssetUrl(filePath);
    return assetUrl || localPathToFileUrl(filePath);
  }

  if (isLikelyAbsoluteLocalPath(url)) {
    const assetUrl = toAssetUrl(url);
    return assetUrl || localPathToFileUrl(url);
  }

  return url;
}

function extractLocalPath(rawUrl?: string): string | null {
  const url = String(rawUrl ?? '').trim();
  if (!url) return null;

  const lower = url.toLowerCase();
  if (lower.startsWith('file://')) {
    const filePath = normalizeFileUrlToPath(url);
    if (!filePath) return null;
    const normalized = normalizeLocalPath(filePath);
    return normalized || null;
  }

  if (isLikelyAbsoluteLocalPath(url)) {
    const normalized = normalizeLocalPath(url);
    return normalized || null;
  }

  if (isLikelyRelativeLocalImagePath(url)) {
    return url;
  }

  return null;
}

function localPathToFileUrl(inputPath: string): string {
  const path = normalizeLocalPath(inputPath);
  if (!path) return '';

  if (isWindowsAbsolutePath(path)) {
    let p = path.replace(/\\/g, '/');
    p = p.replace(/^([a-zA-Z]):(?!\/)/, '$1:/');
    return `file:///${encodeURI(p)}`;
  }

  if (isUncPath(path)) {
    const p = path.replace(/^\\\\/, '').replace(/\\/g, '/');
    return `file://${encodeURI(p)}`;
  }

  if (path.startsWith('/')) {
    return `file://${encodeURI(path)}`;
  }

  return '';
}

function normalizeLocalMarkdownLinks(markdown: string): string {
  return markdown.replace(/(!?\[[^\]]*\]\()([^\)]+)(\))/g, (full, prefix, rawDest, suffix) => {
    const dest = String(rawDest ?? '').trim();
    if (!dest) return full;

    const wrapped = dest.startsWith('<') && dest.endsWith('>');
    const candidate = wrapped ? dest.slice(1, -1).trim() : dest;
    if (!candidate) return full;

    if (isBlockedScheme(candidate)) return `${prefix}${candidate}${suffix}`;

    if (candidate.toLowerCase().startsWith('file://')) {
      const filePath = normalizeFileUrlToPath(candidate);
      if (!filePath) return full;
      const canonical = localPathToFileUrl(filePath);
      return canonical ? `${prefix}${canonical}${suffix}` : full;
    }

    if (isLikelyAbsoluteLocalPath(candidate)) {
      const canonical = localPathToFileUrl(candidate);
      return canonical ? `${prefix}${canonical}${suffix}` : full;
    }

    return full;
  });
}

function splitByFencedCodeBlocks(markdown: string): Array<{ kind: 'text' | 'fence'; value: string }> {
  const out: Array<{ kind: 'text' | 'fence'; value: string }> = [];
  const s = markdown;
  const n = s.length;
  let i = 0;

  const isLineStart = (idx: number) => idx === 0 || s[idx - 1] === '\n';

  const findFenceStart = (from: number) => {
    let j = from;
    while (j < n) {
      const k = s.indexOf('```', j);
      if (k === -1) return -1;
      if (isLineStart(k)) return k;
      j = k + 3;
    }
    return -1;
  };

  const findFenceEnd = (from: number) => {
    let j = from;
    while (j < n) {
      const k = s.indexOf('```', j);
      if (k === -1) return -1;
      if (isLineStart(k)) {
        const lineEnd = s.indexOf('\n', k);
        return lineEnd === -1 ? n : lineEnd + 1;
      }
      j = k + 3;
    }
    return -1;
  };

  while (i < n) {
    const start = findFenceStart(i);
    if (start === -1) {
      out.push({ kind: 'text', value: s.slice(i) });
      break;
    }

    if (start > i) out.push({ kind: 'text', value: s.slice(i, start) });

    const afterStartLine = s.indexOf('\n', start);
    if (afterStartLine === -1) {
      out.push({ kind: 'fence', value: s.slice(start) });
      break;
    }

    const end = findFenceEnd(afterStartLine + 1);
    if (end === -1) {
      out.push({ kind: 'fence', value: s.slice(start) });
      break;
    }
    out.push({ kind: 'fence', value: s.slice(start, end) });
    i = end;
  }

  return out;
}

function transformMathInPlainTextSegment(text: string): string {
  // Option 1: prefer \( ... \) and \[ ... \] and avoid $...$ ambiguities.
  // Keep existing $...$ / $$...$$ working (many models output it).
  let t = text;

  // Block math: \[ ... \] -> $$ ... $$
  // Add newlines around to keep it a proper block.
  t = t.replace(/\\\[([\\s\\S]*?)\\\]/g, (_m, inner: string) => {
    const body = String(inner ?? '').trim();
    return `\n$$\n${body}\n$$\n`;
  });

  // Inline math: \( ... \) -> $ ... $
  t = t.replace(/\\\(([\\s\\S]*?)\\\)/g, (_m, inner: string) => {
    const body = String(inner ?? '').trim();
    return `$${body}$`;
  });

  // Fix block math with internal newlines - ensure $$ is on its own line
  // This helps remarkMath parse multi-line block formulas correctly
  t = t.replace(/\$\$([^$]+)\$\$/g, (_m, inner: string) => {
    const body = String(inner ?? '').trim();
    // Ensure the block math is properly formatted with newlines
    return `\n$$\n${body}\n$$\n`;
  });

  return t;
}

function normalizeMathMarkdown(markdown: string): string {
  const parts = splitByFencedCodeBlocks(markdown);
  let out = '';

  for (const part of parts) {
    if (part.kind === 'fence') {
      out += part.value;
      continue;
    }

    const s = part.value;
    let i = 0;
    let inInline = false;
    let delim = '';
    let buf = '';

    const flush = () => {
      if (!buf) return;
      out += transformMathInPlainTextSegment(buf);
      buf = '';
    };

    while (i < s.length) {
      const ch = s[i];
      if (!inInline) {
        if (ch === '`') {
          flush();
          let j = i;
          while (j < s.length && s[j] === '`') j++;
          delim = s.slice(i, j);
          out += delim;
          inInline = true;
          i = j;
          continue;
        }
        buf += ch;
        i++;
        continue;
      }

      // In inline code: emit raw until closing backticks.
      if (delim && s.startsWith(delim, i)) {
        out += s.slice(i, i + delim.length);
        i += delim.length;
        inInline = false;
        delim = '';
        continue;
      }
      out += ch;
      i++;
    }

    flush();
  }

  return out;
}

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

function SvgBlock({ code }: { code: string }) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <div className="rounded-xl border border-border/60 bg-background/60 overflow-hidden relative group not-prose">
        <div
          className="p-3 overflow-auto flex justify-center bg-white/5"
          dangerouslySetInnerHTML={{ __html: code }}
          style={{ maxWidth: '100%' }}
        />
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="absolute bottom-2 right-2 h-8 w-8 rounded-lg bg-background/90 border border-border/60 shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-background"
          title="放大查看"
        >
          <Maximize className="w-4 h-4" />
        </button>
      </div>

      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm p-8"
          onClick={() => setIsModalOpen(false)}
        >
          <div className="relative max-w-[95vw] max-h-[90vh] w-full h-full flex items-center justify-center">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 h-10 w-10 rounded-full bg-background border border-border/60 shadow-lg flex items-center justify-center hover:bg-accent transition-colors z-10"
              title="关闭"
            >
              <X className="w-5 h-5" />
            </button>
            <div
              className="w-full h-full flex items-center justify-center overflow-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                dangerouslySetInnerHTML={{ __html: code }}
                style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
              />
            </div>
          </div>
        </div>
      )}
    </>
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
      <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-[11px] text-muted-foreground font-bold not-prose">
        Rendering diagram...
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-background/60 overflow-hidden not-prose">
      <div className="p-3 overflow-auto" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}

function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const raw = String(src ?? '').trim();
  const [resolvedSrc, setResolvedSrc] = useState(() => {
    const localPath = extractLocalPath(raw);
    if (localPath) return '';
    return resolveLocalAwareUrl(raw);
  });

  useEffect(() => {
    let cancelled = false;
    const localPath = extractLocalPath(raw);

    if (!localPath) {
      setResolvedSrc(resolveLocalAwareUrl(raw));
      return () => {
        cancelled = true;
      };
    }

    readLocalImageDataUrl(localPath)
      .then((dataUrl) => {
        if (cancelled) return;
        if (dataUrl) {
          setResolvedSrc(dataUrl);
          return;
        }
        if (isLikelyAbsoluteLocalPath(localPath)) {
          const fallback = toAssetUrl(localPath) || localPathToFileUrl(localPath);
          setResolvedSrc(fallback);
          return;
        }
        setResolvedSrc('');
      })
      .catch(() => {
        if (cancelled) return;
        if (isLikelyAbsoluteLocalPath(localPath)) {
          const fallback = toAssetUrl(localPath) || localPathToFileUrl(localPath);
          setResolvedSrc(fallback);
          return;
        }
        setResolvedSrc('');
      });

    return () => {
      cancelled = true;
    };
  }, [raw]);

  if (!resolvedSrc) {
    return <span className="text-xs text-muted-foreground">[invalid image src]</span>;
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt ?? 'image'}
      loading="lazy"
      className="max-w-full h-auto rounded-xl border border-border/40"
    />
  );
}

export function RichMarkdown({ markdown, className }: { markdown: string; className?: string }) {
  const normalized = useMemo(() => {
    const withMath = normalizeMathMarkdown(markdown);
    return normalizeLocalMarkdownLinks(withMath);
  }, [markdown]);
  return (
    <div className={cn('prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-p:my-1.5 prose-li:my-0.5 prose-ul:my-2 prose-ol:my-2 prose-headings:my-3 prose-hr:my-4 prose-pre:my-2', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        urlTransform={(url) => url}
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
            const trimmedCode = code.trimStart();
            const looksLikeSvg =
              trimmedCode.startsWith('<svg') ||
              (trimmedCode.startsWith('<?xml') &&
                (() => {
                  const endDecl = trimmedCode.indexOf('?>');
                  if (endDecl === -1) return false;
                  return trimmedCode.slice(endDecl + 2).trimStart().startsWith('<svg');
                })());

            if (lang?.toLowerCase() === 'mermaid' || cls.includes('language-mermaid')) {
              return <MermaidBlock code={code} />;
            }

            if (
              lang?.toLowerCase() === 'svg' ||
              cls.includes('language-svg') ||
              (lang?.toLowerCase() === 'xml' && looksLikeSvg)
            ) {
              return <SvgBlock code={code} />;
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
          img(props) {
            const { src, alt } = props as any;
            return <MarkdownImage src={src} alt={alt} />;
          },
          a(props) {
            const { href, children } = props as any;
            const resolvedHref = resolveLocalAwareUrl(href);
            if (!resolvedHref) {
              return <span>{children}</span>;
            }
            return (
              <a href={resolvedHref} target="_blank" rel="noreferrer" className="underline decoration-primary/40 hover:decoration-primary break-all">
                {children}
              </a>
            );
          },
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
