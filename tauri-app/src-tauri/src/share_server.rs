use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use tiny_http::{Header, Response, Server};

/// Shared message structure for the share viewer
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SharedMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

/// Shared session structure
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SharedSession {
    pub id: String,
    pub created_at: i64,
    pub messages: Vec<SharedMessage>,
    pub provider_name: Option<String>,
    pub title: Option<String>,
}

/// Response for share creation
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ShareCreateResponse {
    pub share_id: String,
    pub url: String,
}

/// In-memory store for shares
static SHARES: Lazy<Arc<Mutex<HashMap<String, SharedSession>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// Server port storage
static SERVER_PORT: Lazy<Arc<Mutex<Option<u16>>>> = Lazy::new(|| Arc::new(Mutex::new(None)));

/// Create a new share and return share ID
pub fn create_share(session: SharedSession) -> ShareCreateResponse {
    let share_id = session.id.clone();

    {
        let mut shares = SHARES.lock().unwrap();
        shares.insert(share_id.clone(), session);
    }

    let port = get_server_port().unwrap_or(8765);
    let url = format!("http://127.0.0.1:{}/share/{}", port, share_id);

    ShareCreateResponse { share_id, url }
}

/// Get a share by ID
pub fn get_share(share_id: &str) -> Option<SharedSession> {
    let shares = SHARES.lock().unwrap();
    shares.get(share_id).cloned()
}

/// Get the server port
pub fn get_server_port() -> Option<u16> {
    *SERVER_PORT.lock().unwrap()
}

/// Set the server port
fn set_server_port(port: u16) {
    *SERVER_PORT.lock().unwrap() = Some(port);
}

// HTML template for rendering shared sessions
fn generate_share_html(session: &SharedSession) -> String {
    let messages_json =
        serde_json::to_string(&session.messages).unwrap_or_else(|_| "[]".to_string());
    let title = session
        .title
        .clone()
        .unwrap_or_else(|| "Shared Chat".to_string());
    let provider = session
        .provider_name
        .clone()
        .unwrap_or_else(|| "AI Assistant".to_string());

    format!(
        r##"<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title} - inFlow Share</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
    <style>
        :root {{
            --background: 0 0% 100%;
            --foreground: 240 10% 3.9%;
            --muted: 240 4.8% 95.9%;
            --muted-foreground: 240 3.8% 46.1%;
            --primary: 240 5.9% 10%;
            --border: 240 5.9% 90%;
        }}
        @media (prefers-color-scheme: dark) {{
            :root {{
                --background: 240 10% 3.9%;
                --foreground: 0 0% 98%;
                --muted: 240 3.7% 15.9%;
                --muted-foreground: 240 5% 64.9%;
                --primary: 0 0% 98%;
                --border: 240 3.7% 15.9%;
            }}
        }}
        body {{
            background-color: hsl(var(--background));
            color: hsl(var(--foreground));
        }}
        .message-user {{
            background-color: hsl(var(--foreground));
            color: hsl(var(--background));
        }}
        .message-assistant {{
            background-color: transparent;
        }}
        .prose pre {{
            background-color: hsl(var(--muted));
            border-radius: 0.75rem;
            padding: 1rem;
            overflow-x: auto;
        }}
        .prose code {{
            background-color: hsl(var(--muted));
            padding: 0.125rem 0.375rem;
            border-radius: 0.25rem;
            font-size: 0.875em;
        }}
        .prose pre code {{
            background-color: transparent;
            padding: 0;
        }}
        .prose table {{
            border-collapse: collapse;
            width: 100%;
        }}
        .prose th, .prose td {{
            border: 1px solid hsl(var(--border));
            padding: 0.5rem 0.75rem;
            text-align: left;
        }}
        .prose th {{
            background-color: hsl(var(--muted));
        }}
        .prose blockquote {{
            border-left: 4px solid hsl(var(--border));
            padding-left: 1rem;
            color: hsl(var(--muted-foreground));
            font-style: italic;
        }}
        .copy-btn {{
            position: absolute;
            top: 0.5rem;
            right: 0.5rem;
            padding: 0.25rem 0.5rem;
            background: hsl(var(--muted));
            border: 1px solid hsl(var(--border));
            border-radius: 0.375rem;
            font-size: 0.75rem;
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.2s;
        }}
        .code-wrapper:hover .copy-btn {{
            opacity: 1;
        }}
    </style>
</head>
<body class="min-h-screen">
    <div class="max-w-4xl mx-auto py-8 px-4">
        <!-- Header -->
        <header class="mb-8 pb-6 border-b border-[hsl(var(--border))]">
            <div class="flex items-center gap-3 mb-2">
                <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 8V4H8"/>
                        <rect width="16" height="12" x="4" y="8" rx="2"/>
                        <path d="M2 14h2"/>
                        <path d="M20 14h2"/>
                        <path d="M15 13v2"/>
                        <path d="M9 13v2"/>
                    </svg>
                </div>
                <div>
                    <h1 class="text-xl font-bold">{title}</h1>
                    <p class="text-sm text-[hsl(var(--muted-foreground))]">Shared via inFlow • {provider}</p>
                </div>
            </div>
        </header>

        <!-- Messages -->
        <div id="messages" class="space-y-6">
        </div>

        <!-- Footer -->
        <footer class="mt-12 pt-6 border-t border-[hsl(var(--border))] text-center">
            <p class="text-sm text-[hsl(var(--muted-foreground))]">
                Powered by <a href="https://github.com/nicepkg/inflow" class="font-semibold hover:underline">inFlow</a>
            </p>
        </footer>
    </div>

    <script>
        const messages = {messages_json};

        // Initialize mermaid
        mermaid.initialize({{ startOnLoad: false, theme: 'default', securityLevel: 'strict' }});

        // ============================================================
        // Math preprocessing - matches RichMarkdown.tsx logic exactly
        // ============================================================

        // Split markdown by fenced code blocks to avoid processing math inside code
        function splitByFencedCodeBlocks(markdown) {{
            const out = [];
            const s = markdown;
            const n = s.length;
            let i = 0;

            const isLineStart = (idx) => idx === 0 || s[idx - 1] === '\\n';

            const findFenceStart = (from) => {{
                let j = from;
                while (j < n) {{
                    const k = s.indexOf('```', j);
                    if (k === -1) return -1;
                    if (isLineStart(k)) return k;
                    j = k + 3;
                }}
                return -1;
            }};

            const findFenceEnd = (from) => {{
                let j = from;
                while (j < n) {{
                    const k = s.indexOf('```', j);
                    if (k === -1) return -1;
                    if (isLineStart(k)) {{
                        const lineEnd = s.indexOf('\\n', k);
                        return lineEnd === -1 ? n : lineEnd + 1;
                    }}
                    j = k + 3;
                }}
                return -1;
            }};

            while (i < n) {{
                const start = findFenceStart(i);
                if (start === -1) {{
                    out.push({{ kind: 'text', value: s.slice(i) }});
                    break;
                }}

                if (start > i) out.push({{ kind: 'text', value: s.slice(i, start) }});

                const afterStartLine = s.indexOf('\\n', start);
                if (afterStartLine === -1) {{
                    out.push({{ kind: 'fence', value: s.slice(start) }});
                    break;
                }}

                const end = findFenceEnd(afterStartLine + 1);
                if (end === -1) {{
                    out.push({{ kind: 'fence', value: s.slice(start) }});
                    break;
                }}
                out.push({{ kind: 'fence', value: s.slice(start, end) }});
                i = end;
            }}

            return out;
        }}

        // Transform math notation in plain text segments
        function transformMathInPlainTextSegment(text) {{
            // We don't transform here anymore - just return as-is
            // Math will be protected before marked.js and restored after
            return text;
        }}

        // Protect math from marked.js by replacing with placeholders
        function protectMath(text) {{
            const blocks = [];
            let idx = 0;

            // Protect block math $$...$$ (multiline)
            text = text.replace(/\$\$([^]*?)\$\$/g, (match) => {{
                const placeholder = '%%MATHBLOCK' + idx + '%%';
                blocks.push({{ placeholder, content: match }});
                idx++;
                return placeholder;
            }});

            // Protect \[...\] block math
            text = text.replace(/\\\[([^]*?)\\\]/g, (match) => {{
                const placeholder = '%%MATHBLOCK' + idx + '%%';
                // Convert to $$ format for KaTeX
                const inner = match.slice(2, -2);
                blocks.push({{ placeholder, content: '$$' + inner + '$$' }});
                idx++;
                return placeholder;
            }});

            // Protect inline math $...$ (single line, not $$)
            text = text.replace(/\$([^\$\n]+?)\$/g, (match) => {{
                const placeholder = '%%MATHINLINE' + idx + '%%';
                blocks.push({{ placeholder, content: match }});
                idx++;
                return placeholder;
            }});

            // Protect \(...\) inline math
            text = text.replace(/\\\(([^]*?)\\\)/g, (match) => {{
                const placeholder = '%%MATHINLINE' + idx + '%%';
                // Convert to $ format for KaTeX
                const inner = match.slice(2, -2);
                blocks.push({{ placeholder, content: '$' + inner + '$' }});
                idx++;
                return placeholder;
            }});

            return {{ text, blocks }};
        }}

        // Restore math after marked.js processing
        function restoreMath(html, blocks) {{
            for (const b of blocks) {{
                // The placeholder might be wrapped in <p> tags, handle that
                html = html.split(b.placeholder).join(b.content);
            }}
            return html;
        }}

        // Normalize math markdown - matches RichMarkdown.tsx normalizeMathMarkdown
        function normalizeMathMarkdown(markdown) {{
            const parts = splitByFencedCodeBlocks(markdown);
            let out = '';

            for (const part of parts) {{
                if (part.kind === 'fence') {{
                    out += part.value;
                    continue;
                }}

                const s = part.value;
                let i = 0;
                let inInline = false;
                let delim = '';
                let buf = '';

                const flush = () => {{
                    if (!buf) return;
                    out += transformMathInPlainTextSegment(buf);
                    buf = '';
                }};

                while (i < s.length) {{
                    const ch = s[i];
                    if (!inInline) {{
                        if (ch === '`') {{
                            flush();
                            let j = i;
                            while (j < s.length && s[j] === '`') j++;
                            delim = s.slice(i, j);
                            out += delim;
                            inInline = true;
                            i = j;
                            continue;
                        }}
                        buf += ch;
                        i++;
                        continue;
                    }}

                    // In inline code: emit raw until closing backticks
                    if (delim && s.startsWith(delim, i)) {{
                        out += s.slice(i, i + delim.length);
                        i += delim.length;
                        inInline = false;
                        delim = '';
                        continue;
                    }}
                    out += ch;
                    i++;
                }}

                flush();
            }}

            return out;
        }}

        // ============================================================
        // Code block rendering
        // ============================================================

        const renderer = new marked.Renderer();
        renderer.code = function(codeObj) {{
            // Handle both old and new marked.js API
            const code = typeof codeObj === 'string' ? codeObj : (codeObj.text || codeObj.raw || '');
            const lang = (typeof codeObj === 'object' ? codeObj.lang : arguments[1]) || 'plaintext';

            // Handle mermaid diagrams
            if (lang.toLowerCase() === 'mermaid') {{
                const id = 'mermaid-' + Math.random().toString(36).substr(2, 9);
                return '<div class="mermaid" id="' + id + '">' + escapeHtml(code) + '</div>';
            }}

            // Handle SVG - render directly
            const trimmedCode = code.trim();
            const looksLikeSvg = trimmedCode.startsWith('<svg') ||
                (trimmedCode.startsWith('<?xml') && trimmedCode.includes('<svg'));

            if (lang.toLowerCase() === 'svg' || (lang.toLowerCase() === 'xml' && looksLikeSvg)) {{
                return '<div class="svg-container my-4 p-3 rounded-xl border flex justify-center overflow-auto">' + code + '</div>';
            }}

            // Handle HTML blocks that might contain SVG
            if (lang.toLowerCase() === 'html' && code.includes('<svg')) {{
                return '<div class="html-container my-4">' + code + '</div>';
            }}

            // Regular code with syntax highlighting
            let highlighted;
            try {{
                highlighted = hljs.getLanguage(lang)
                    ? hljs.highlight(code, {{ language: lang }}).value
                    : hljs.highlightAuto(code).value;
            }} catch (e) {{
                highlighted = escapeHtml(code);
            }}

            const normalizedLang = lang.toLowerCase() === 'py' ? 'python' :
                                   lang.toLowerCase() === 'js' ? 'javascript' :
                                   lang.toLowerCase() === 'ts' ? 'typescript' : lang;

            return '<div class="code-fence group relative rounded-xl border overflow-hidden my-2">' +
                '<div class="flex items-center justify-between px-3 py-1.5 border-b bg-[hsl(var(--muted))]">' +
                    '<div class="text-[9px] font-black uppercase tracking-[0.28em]">' + normalizedLang + '</div>' +
                    '<button class="copy-btn opacity-0 group-hover:opacity-100" onclick="copyCode(this)">Copy</button>' +
                '</div>' +
                '<pre class="m-0 p-3 overflow-auto text-[12px] leading-relaxed">' +
                    '<code class="hljs language-' + lang + '">' + highlighted + '</code>' +
                '</pre>' +
            '</div>';
        }};

        marked.setOptions({{
            renderer,
            breaks: true,
            gfm: true
        }});

        function copyCode(btn) {{
            const pre = btn.closest('.code-fence').querySelector('pre code');
            const code = pre ? pre.textContent : '';
            navigator.clipboard.writeText(code).then(() => {{
                btn.textContent = 'Copied!';
                setTimeout(() => btn.textContent = 'Copy', 900);
            }});
        }}

        function escapeHtml(text) {{
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }}

        async function renderMessages() {{
            const container = document.getElementById('messages');

            for (const msg of messages) {{
                const div = document.createElement('div');
                div.className = 'flex w-full ' + (msg.role === 'user' ? 'justify-end' : 'justify-start');

                const inner = document.createElement('div');
                if (msg.role === 'user') {{
                    inner.className = 'message-user max-w-[85%] rounded-2xl px-4 py-3 shadow-sm';
                    inner.innerHTML = '<div class="text-sm font-semibold leading-relaxed whitespace-pre-wrap">' + escapeHtml(msg.content) + '</div>';
                }} else {{
                    inner.className = 'message-assistant w-full max-w-none prose prose-sm dark:prose-invert';
                    // Protect math from marked.js, parse, then restore
                    const {{ text: protectedText, blocks }} = protectMath(msg.content);
                    const parsedHtml = marked.parse(protectedText);
                    inner.innerHTML = restoreMath(parsedHtml, blocks);
                }}

                div.appendChild(inner);
                container.appendChild(div);
            }}

            // Render mermaid diagrams
            try {{
                await mermaid.run({{ querySelector: '.mermaid' }});
            }} catch (e) {{
                console.warn('Mermaid rendering error:', e);
            }}

            // Render math with KaTeX
            if (typeof renderMathInElement !== 'undefined') {{
                renderMathInElement(document.body, {{
                    delimiters: [
                        {{left: '$$', right: '$$', display: true}},
                        {{left: '$', right: '$', display: false}}
                    ],
                    throwOnError: false,
                    strict: false
                }});
            }}
        }}

        renderMessages();
    </script>
</body>
</html>"##,
        title = title,
        provider = provider,
        messages_json = messages_json
    )
}

fn generate_404_html() -> String {
    r#"<!DOCTYPE html>
<html>
<head><title>Not Found</title></head>
<body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
<div style="text-align: center;">
<h1 style="font-size: 4rem; margin: 0;">404</h1>
<p style="color: #666;">Share not found or has expired</p>
</div>
</body>
</html>"#.to_string()
}

/// Handle incoming HTTP requests
fn handle_request(request: tiny_http::Request) {
    let url = request.url().to_string();

    // Parse the path
    if url.starts_with("/share/") {
        let share_id = url.strip_prefix("/share/").unwrap_or("");

        match get_share(share_id) {
            Some(session) => {
                let html = generate_share_html(&session);
                let response = Response::from_string(html).with_header(
                    Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
                        .unwrap(),
                );
                let _ = request.respond(response);
            }
            None => {
                let html = generate_404_html();
                let response = Response::from_string(html)
                    .with_status_code(404)
                    .with_header(
                        Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
                            .unwrap(),
                    );
                let _ = request.respond(response);
            }
        }
    } else if url.starts_with("/api/share/") {
        let share_id = url.strip_prefix("/api/share/").unwrap_or("");

        match get_share(share_id) {
            Some(session) => {
                let json = serde_json::to_string(&session).unwrap_or_else(|_| "{}".to_string());
                let response = Response::from_string(json)
                    .with_header(
                        Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
                    )
                    .with_header(
                        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
                    );
                let _ = request.respond(response);
            }
            None => {
                let response = Response::from_string(r#"{"error": "Share not found"}"#)
                    .with_status_code(404)
                    .with_header(
                        Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
                    )
                    .with_header(
                        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
                    );
                let _ = request.respond(response);
            }
        }
    } else if url == "/health" {
        let response = Response::from_string(r#"{"status": "ok"}"#).with_header(
            Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
        );
        let _ = request.respond(response);
    } else {
        let response = Response::from_string("Not Found").with_status_code(404);
        let _ = request.respond(response);
    }
}

/// Start the share server on a random available port
pub fn start_server() -> Result<u16, std::io::Error> {
    // Try ports starting from 8765
    let ports_to_try = [8765u16, 8766, 8767, 8768, 8769, 18765, 28765];

    for port in ports_to_try {
        let bind_addr = format!("0.0.0.0:{}", port);

        match Server::http(&bind_addr) {
            Ok(server) => {
                set_server_port(port);
                println!("[share-server] Starting on http://127.0.0.1:{}", port);

                // Spawn the server in a background thread
                thread::spawn(move || {
                    for request in server.incoming_requests() {
                        handle_request(request);
                    }
                });

                return Ok(port);
            }
            Err(e) => {
                println!(
                    "[share-server] Port {} unavailable: {}, trying next...",
                    port, e
                );
                continue;
            }
        }
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::AddrInUse,
        "No available ports found",
    ))
}
