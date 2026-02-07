use std::fs::{self, File};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::{
    env,
    path::{Path, PathBuf},
};

use futures::future::BoxFuture;
use genai::chat::Tool;
use serde::Deserialize;
use serde_json::Value;
use tauri::async_runtime;
use url::Url;

use crate::config::{AppConfig, LlmProvider};
use crate::genai_client::sanitize_tool_schema_for_provider;
use crate::llm_tools::ToolExecResult;
use crate::state::AppState;

use super::BuiltinToolSpec;

pub const TOOL_AGENT_BROWSER: &str = "inflow__agent_browser";

const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_TIMEOUT_SECS: u64 = 120;
const MIN_TIMEOUT_SECS: u64 = 1;
const MAX_RAW_CHARS: usize = 20_000;
const MAX_RESPONSE_CHARS: usize = 8_000;
const DEBUG_LOG_CHARS: usize = 4_000;
const MAX_SESSION_LEN: usize = 80;

#[derive(Debug, Deserialize)]
struct AgentBrowserJsonOutput {
    success: bool,
    data: Option<Value>,
    error: Option<String>,
}

#[derive(Debug)]
struct CommandExec {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    timed_out: bool,
    duration_ms: u128,
}

fn build(provider: &LlmProvider) -> Tool {
    let schema = serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "action": {
                "type": "string",
                "description": "Browser action to execute.",
                "enum": [
                    "open",
                    "snapshot",
                    "click",
                    "fill",
                    "type",
                    "press",
                    "wait",
                    "get",
                    "tab",
                    "screenshot",
                    "close"
                ]
            },
            "session": {
                "type": "string",
                "description": "Optional session name. If omitted, uses chat-session-isolated default."
            },
            "timeoutSec": {
                "type": "number",
                "description": "Command timeout in seconds (1-120).",
                "default": 30
            },

            "url": {
                "type": "string",
                "description": "URL for open action. Only http/https are allowed."
            },
            "selector": {
                "type": "string",
                "description": "Element selector or snapshot ref such as @e1."
            },
            "text": {
                "type": "string",
                "description": "Text value for fill/type, or wait text when waitMode=text."
            },
            "key": {
                "type": "string",
                "description": "Keyboard key for press action, e.g. Enter, Tab, Control+a."
            },

            "snapshotInteractive": {
                "type": "boolean",
                "description": "snapshot: include interactive elements only.",
                "default": true
            },
            "snapshotCursor": {
                "type": "boolean",
                "description": "snapshot: include cursor-interactive elements.",
                "default": false
            },
            "snapshotCompact": {
                "type": "boolean",
                "description": "snapshot: compact tree output.",
                "default": true
            },
            "snapshotDepth": {
                "type": "integer",
                "description": "snapshot: optional max tree depth (1-20).",
                "minimum": 1,
                "maximum": 20
            },
            "snapshotScope": {
                "type": "string",
                "description": "snapshot: optional CSS scope selector."
            },

            "waitMode": {
                "type": "string",
                "description": "wait: selector|ms|text|url|load",
                "enum": ["selector", "ms", "text", "url", "load"],
                "default": "selector"
            },
            "waitValue": {
                "description": "wait: selector string, milliseconds, text, URL pattern, or load state value depending on waitMode."
            },
            "loadState": {
                "type": "string",
                "description": "wait load state.",
                "enum": ["load", "domcontentloaded", "networkidle"]
            },

            "getKind": {
                "type": "string",
                "description": "get subcommand.",
                "enum": ["text", "html", "value", "attr", "title", "url", "count", "box"]
            },
            "attrName": {
                "type": "string",
                "description": "Attribute name when getKind=attr."
            },

            "tabMode": {
                "type": "string",
                "description": "tab subcommand: list|new|switch|close",
                "enum": ["list", "new", "switch", "close"],
                "default": "list"
            },
            "tabIndex": {
                "type": "integer",
                "description": "tab index (0-based) used by switch/close.",
                "minimum": 0
            },
            "tabUrl": {
                "type": "string",
                "description": "Optional URL for tab new action. Only http/https are allowed."
            },

            "screenshotPath": {
                "type": "string",
                "description": "Optional output path for screenshot."
            },
            "screenshotFull": {
                "type": "boolean",
                "description": "Take full-page screenshot.",
                "default": false
            }
        },
        "required": ["action"]
    });

    let schema = sanitize_tool_schema_for_provider(provider, &schema);
    Tool::new(TOOL_AGENT_BROWSER)
        .with_description(
            "Safe browser automation via agent-browser CLI (open/snapshot/click/fill/type/press/wait/get/tab/screenshot/close).",
        )
        .with_schema(schema)
}

fn exec<'a>(
    _provider: &'a LlmProvider,
    config: &'a AppConfig,
    _state: &'a AppState,
    args: &'a serde_json::Value,
) -> BoxFuture<'a, Result<ToolExecResult, String>> {
    Box::pin(async move {
        let debug = tools_debug_enabled();
        let action = arg_str(args, "action")
            .ok_or_else(|| "action is required".to_string())?
            .to_ascii_lowercase();

        let timeout_secs = arg_u64_any(args, &["timeoutSec", "timeout"])
            .unwrap_or(DEFAULT_TIMEOUT_SECS)
            .clamp(MIN_TIMEOUT_SECS, MAX_TIMEOUT_SECS);

        let session = resolve_session_name(args);
        let browser_executable = resolve_browser_executable_path(config);
        let cli_args = build_cli_args(&action, args, &session, browser_executable.as_deref())?;
        let cli_args_for_exec = cli_args.clone();
        let timeout = Duration::from_secs(timeout_secs);
        let executable = resolve_agent_browser_executable(config);
        let executable_for_exec = executable.clone();

        if debug {
            println!(
                "[tools][debug] agent-browser start action={} session={} timeoutSec={} executable={} browserExecutable={} command={}",
                action,
                session,
                timeout_secs,
                executable,
                browser_executable.as_deref().unwrap_or("<default>"),
                render_command_for_log_line(&cli_args)
            );
        }

        let exec = async_runtime::spawn_blocking(move || {
            run_agent_browser(&executable_for_exec, cli_args_for_exec, timeout)
        })
        .await
        .map_err(|e| format!("agent-browser task join failed: {}", e))??;

        if debug {
            println!(
                "[tools][debug] agent-browser done action={} session={} exitCode={:?} timedOut={} durationMs={}",
                action,
                session,
                exec.exit_code,
                exec.timed_out,
                exec.duration_ms
            );
            let (stdout_dbg, stdout_trunc) = truncate_to_chars(exec.stdout.trim(), DEBUG_LOG_CHARS);
            if !stdout_dbg.is_empty() {
                println!(
                    "[tools][debug] agent-browser stdout{}: {}",
                    if stdout_trunc { " (truncated)" } else { "" },
                    stdout_dbg
                );
            }
            let (stderr_dbg, stderr_trunc) = truncate_to_chars(exec.stderr.trim(), DEBUG_LOG_CHARS);
            if !stderr_dbg.is_empty() {
                println!(
                    "[tools][debug] agent-browser stderr{}: {}",
                    if stderr_trunc { " (truncated)" } else { "" },
                    stderr_dbg
                );
            }
        }

        if exec.timed_out {
            if debug {
                println!(
                    "[tools][debug] agent-browser return error action={} reason=timeout timeoutSec={}",
                    action, timeout_secs
                );
            }
            return Err(format!(
                "agent-browser action '{}' timed out after {}s",
                action, timeout_secs
            ));
        }

        let parsed = parse_agent_browser_json(&exec.stdout);

        if debug {
            match parsed.as_ref() {
                Some(p) => {
                    println!(
                        "[tools][debug] agent-browser parsed action={} success={} hasData={} hasError={}",
                        action,
                        p.success,
                        p.data.is_some(),
                        p.error.as_ref().map(|s| !s.trim().is_empty()).unwrap_or(false)
                    );
                }
                None => {
                    println!(
                        "[tools][debug] agent-browser parsed action={} success=<none> stdoutChars={} stderrChars={}",
                        action,
                        exec.stdout.chars().count(),
                        exec.stderr.chars().count()
                    );
                }
            }
        }

        if let Some(p) = parsed.as_ref() {
            if !p.success {
                let err = p.error.as_deref().unwrap_or("unknown agent-browser error");
                let (err_msg, _) = truncate_to_chars(err, MAX_RAW_CHARS);
                if debug {
                    println!(
                        "[tools][debug] agent-browser return error action={} reason=tool_failed message={}",
                        action, err_msg
                    );
                }
                return Err(format!(
                    "agent-browser action '{}' failed: {}",
                    action, err_msg
                ));
            }
        }

        if exec.exit_code.unwrap_or(1) != 0 {
            let (stderr, _) = truncate_to_chars(exec.stderr.trim(), 8000);
            let suffix = if stderr.is_empty() {
                String::new()
            } else {
                format!(": {}", stderr)
            };
            if debug {
                println!(
                    "[tools][debug] agent-browser return error action={} reason=exit_code code={} stderr={}",
                    action,
                    exec.exit_code.unwrap_or(-1),
                    if stderr.is_empty() { "<empty>" } else { &stderr }
                );
            }
            return Err(format!(
                "agent-browser action '{}' exited with code {}{}",
                action,
                exec.exit_code.unwrap_or(-1),
                suffix
            ));
        }

        let data = parsed
            .as_ref()
            .and_then(|p| p.data.clone())
            .unwrap_or(Value::Null);

        let (raw, raw_truncated) = truncate_to_chars(exec.stdout.trim(), MAX_RAW_CHARS);
        let (stderr, stderr_truncated) = truncate_to_chars(exec.stderr.trim(), MAX_RAW_CHARS);
        let command_for_log = render_command_for_log(&cli_args);

        let content = serde_json::json!({
            "tool": "agent-browser",
            "ok": true,
            "action": action,
            "session": session,
            "timeoutSec": timeout_secs,
            "command": command_for_log,
            "browserExecutablePath": browser_executable,
            "exitCode": exec.exit_code,
            "durationMs": exec.duration_ms,
            "data": data,
            "raw": raw,
            "stderr": stderr,
            "rawTruncated": raw_truncated,
            "stderrTruncated": stderr_truncated,
        });

        let mut response_content = summarize_response_content(&action, &content["data"]);
        if response_content.is_empty() {
            response_content = "ok".to_string();
        }

        if debug {
            println!(
                "[tools][debug] agent-browser return ok action={} responseChars={} dataKind={}",
                action,
                response_content.chars().count(),
                value_kind(&content["data"])
            );
        }

        Ok(ToolExecResult {
            content,
            response_content,
        })
    })
}

fn run_agent_browser(
    executable: &str,
    cli_args: Vec<String>,
    timeout: Duration,
) -> Result<CommandExec, String> {
    let started = Instant::now();
    let executable_lc = executable.to_ascii_lowercase();

    let capture_id = format!(
        "inflow-agent-browser-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let capture_dir = resolve_capture_dir();
    let mut stdout_path = capture_dir.clone();
    stdout_path.push(format!("{}-stdout.log", capture_id));
    let mut stderr_path = capture_dir;
    stderr_path.push(format!("{}-stderr.log", capture_id));

    let stdout_file = File::create(&stdout_path)
        .map_err(|e| format!("failed to create temp stdout file: {}", e))?;
    let stderr_file = File::create(&stderr_path)
        .map_err(|e| format!("failed to create temp stderr file: {}", e))?;

    let mut cmd = if executable_lc.ends_with(".ps1") {
        let mut c = Command::new("powershell");
        c.arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(executable);
        c
    } else if executable_lc.ends_with(".cmd") || executable_lc.ends_with(".bat") {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(executable);
        c
    } else {
        Command::new(executable)
    };

    let mut child = cmd
        .args(&cli_args)
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                format!(
                    "agent-browser is not installed or not found in PATH (executable: {})",
                    executable
                )
            } else {
                format!("failed to start agent-browser '{}': {}", executable, e)
            }
        })?;

    let (exit_code, timed_out) = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("failed to wait for agent-browser: {}", e))?
        {
            break (status.code(), false);
        }

        if started.elapsed() >= timeout {
            let _ = child.kill();
            let status = child.wait().ok();
            break (status.and_then(|s| s.code()), true);
        }

        thread::sleep(Duration::from_millis(20));
    };

    let mut stdout = fs::read_to_string(&stdout_path).unwrap_or_default();
    let mut stderr = fs::read_to_string(&stderr_path).unwrap_or_default();
    let _ = fs::remove_file(&stdout_path);
    let _ = fs::remove_file(&stderr_path);

    if timed_out && stderr.trim().is_empty() {
        stderr = "timed out while waiting for agent-browser process".to_string();
    }
    if timed_out && stdout.trim().is_empty() {
        stdout = String::new();
    }

    Ok(CommandExec {
        stdout,
        stderr,
        exit_code,
        timed_out,
        duration_ms: started.elapsed().as_millis(),
    })
}

fn resolve_capture_dir() -> PathBuf {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(local) = env::var("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local)
                .join("inFlow")
                .join("runtime")
                .join("agent-browser"),
        );
    }

    if let Ok(user) = env::var("USERPROFILE") {
        candidates.push(
            PathBuf::from(&user)
                .join("AppData")
                .join("Local")
                .join("inFlow")
                .join("runtime")
                .join("agent-browser"),
        );
        candidates.push(
            PathBuf::from(user)
                .join("AppData")
                .join("Local")
                .join("Temp")
                .join("inFlow")
                .join("agent-browser"),
        );
    }

    candidates.push(std::env::temp_dir().join("inFlow").join("agent-browser"));

    let cwd = std::env::current_dir().ok();
    for dir in candidates {
        if let Some(cwd) = cwd.as_ref() {
            if dir.starts_with(cwd) {
                continue;
            }
        }
        if fs::create_dir_all(&dir).is_ok() {
            return dir;
        }
    }

    std::env::temp_dir()
}

fn resolve_agent_browser_executable(config: &AppConfig) -> String {
    if let Some(path) = config
        .agent_browser_cli_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return path.to_string();
    }

    for env_key in [
        "INFLOW_AGENT_BROWSER_CLI",
        "INFLOW_AGENT_BROWSER_PATH",
        "AGENT_BROWSER_CLI",
    ] {
        if let Ok(v) = env::var(env_key) {
            let s = v.trim();
            if !s.is_empty() {
                return s.to_string();
            }
        }
    }

    if let Some(path) = discover_agent_browser_cli_path() {
        return path;
    }

    "agent-browser".to_string()
}

fn resolve_browser_executable_path(config: &AppConfig) -> Option<String> {
    if let Some(path) = config
        .agent_browser_executable_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return Some(path.to_string());
    }

    for env_key in [
        "INFLOW_AGENT_BROWSER_EXECUTABLE_PATH",
        "AGENT_BROWSER_EXECUTABLE_PATH",
    ] {
        if let Ok(v) = env::var(env_key) {
            let s = v.trim();
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }

    discover_browser_executable_path()
}

fn discover_agent_browser_cli_path() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let mut candidates: Vec<String> = Vec::new();

        if let Ok(user) = env::var("USERPROFILE") {
            candidates.push(format!(
                "{}\\scoop\\apps\\nvm\\current\\nodejs\\nodejs\\agent-browser.cmd",
                user
            ));
            candidates.push(format!(
                "{}\\scoop\\apps\\nvm\\current\\nodejs\\nodejs\\agent-browser.ps1",
                user
            ));
            candidates.push(format!(
                "{}\\scoop\\apps\\nvm\\current\\nodejs\\nodejs\\agent-browser",
                user
            ));
            candidates.push(format!(
                "{}\\scoop\\persist\\nvm\\nodejs\\nodejs\\node_modules\\agent-browser\\bin\\agent-browser-win32-x64.exe",
                user
            ));
            candidates.push(format!(
                "{}\\scoop\\apps\\nvm\\current\\nodejs\\nodejs\\node_modules\\agent-browser\\bin\\agent-browser-win32-x64.exe",
                user
            ));
        }

        if let Ok(appdata) = env::var("APPDATA") {
            candidates.push(format!("{}\\npm\\agent-browser.cmd", appdata));
            candidates.push(format!("{}\\npm\\agent-browser.ps1", appdata));
            candidates.push(format!(
                "{}\\npm\\node_modules\\agent-browser\\bin\\agent-browser-win32-x64.exe",
                appdata
            ));
        }

        for p in candidates {
            if Path::new(&p).exists() {
                return Some(p);
            }
        }
    }

    None
}

fn discover_browser_executable_path() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let mut candidates: Vec<String> = vec![
            r"C:\Program Files\Google\Chrome\Application\chrome.exe".to_string(),
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe".to_string(),
        ];

        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            candidates.push(format!(
                "{}\\Google\\Chrome\\Application\\chrome.exe",
                local_app_data
            ));
        }

        for p in candidates {
            if Path::new(&p).exists() {
                return Some(p);
            }
        }
    }

    None
}

fn parse_agent_browser_json(stdout: &str) -> Option<AgentBrowserJsonOutput> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(v) = serde_json::from_str::<AgentBrowserJsonOutput>(trimmed) {
        return Some(v);
    }
    for line in trimmed.lines().rev() {
        let s = line.trim();
        if s.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<AgentBrowserJsonOutput>(s) {
            return Some(v);
        }
    }
    None
}

fn resolve_session_name(args: &Value) -> String {
    if let Some(raw) = arg_str(args, "session") {
        return sanitize_session_name(raw);
    }

    if let Some(chat_session_id) = arg_str(args, "_chatSessionId") {
        return sanitize_session_name(&format!("inflow-{}", chat_session_id));
    }

    "inflow-default".to_string()
}

fn sanitize_session_name(raw: &str) -> String {
    let mut out = String::new();
    for ch in raw.trim().chars() {
        if out.len() >= MAX_SESSION_LEN {
            break;
        }
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else {
            out.push('-');
        }
    }

    let compact = out.trim_matches('-').to_string();
    if compact.is_empty() {
        "inflow-default".to_string()
    } else {
        compact
    }
}

fn build_cli_args(
    action: &str,
    args: &Value,
    session: &str,
    browser_executable: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut out = vec![
        "--json".to_string(),
        "--session".to_string(),
        session.to_string(),
    ];

    if let Some(path) = browser_executable.map(str::trim).filter(|s| !s.is_empty()) {
        out.push("--executable-path".to_string());
        out.push(path.to_string());
    }

    match action {
        "open" => {
            let url = arg_str(args, "url").ok_or_else(|| "open requires url".to_string())?;
            validate_http_url(url)?;
            out.push("open".to_string());
            out.push(url.to_string());
        }
        "snapshot" => {
            out.push("snapshot".to_string());
            if arg_bool_any(args, &["snapshotInteractive", "interactive"], true) {
                out.push("-i".to_string());
            }
            if arg_bool_any(args, &["snapshotCursor", "cursor"], false) {
                out.push("-C".to_string());
            }
            if arg_bool_any(args, &["snapshotCompact", "compact"], true) {
                out.push("-c".to_string());
            }
            if let Some(depth) = arg_u64_any(args, &["snapshotDepth", "depth"]) {
                if depth == 0 || depth > 20 {
                    return Err("snapshotDepth must be between 1 and 20".to_string());
                }
                out.push("-d".to_string());
                out.push(depth.to_string());
            }
            if let Some(scope) = arg_str_any(args, &["snapshotScope", "scope"]) {
                out.push("-s".to_string());
                out.push(scope.to_string());
            }
        }
        "click" => {
            out.push("click".to_string());
            out.push(required_selector(args, "click")?.to_string());
        }
        "fill" => {
            out.push("fill".to_string());
            out.push(required_selector(args, "fill")?.to_string());
            let text = arg_str(args, "text").ok_or_else(|| "fill requires text".to_string())?;
            out.push(text.to_string());
        }
        "type" => {
            out.push("type".to_string());
            out.push(required_selector(args, "type")?.to_string());
            let text = arg_str(args, "text").ok_or_else(|| "type requires text".to_string())?;
            out.push(text.to_string());
        }
        "press" => {
            out.push("press".to_string());
            let key = arg_str(args, "key").ok_or_else(|| "press requires key".to_string())?;
            out.push(key.to_string());
        }
        "wait" => {
            out.push("wait".to_string());
            let mode = arg_str_any(args, &["waitMode", "mode"])
                .unwrap_or("selector")
                .to_ascii_lowercase();

            match mode.as_str() {
                "selector" => {
                    let selector = arg_str_any(args, &["selector", "waitValue", "value"])
                        .ok_or_else(|| {
                            "wait selector mode requires selector or waitValue".to_string()
                        })?;
                    out.push(selector.to_string());
                }
                "ms" => {
                    let ms = arg_u64_any(args, &["waitValue", "value", "ms"])
                        .ok_or_else(|| "wait ms mode requires numeric waitValue".to_string())?;
                    if ms == 0 {
                        return Err("waitValue must be greater than 0 for waitMode=ms".to_string());
                    }
                    out.push(ms.to_string());
                }
                "text" => {
                    let text = arg_str_any(args, &["waitValue", "text", "value"])
                        .ok_or_else(|| "wait text mode requires waitValue or text".to_string())?;
                    out.push("--text".to_string());
                    out.push(text.to_string());
                }
                "url" => {
                    let pattern = arg_str_any(args, &["waitValue", "url", "value"])
                        .ok_or_else(|| "wait url mode requires waitValue or url".to_string())?;
                    out.push("--url".to_string());
                    out.push(pattern.to_string());
                }
                "load" => {
                    let state = arg_str_any(args, &["loadState", "waitValue", "value"])
                        .unwrap_or("networkidle")
                        .to_ascii_lowercase();
                    if !matches!(state.as_str(), "load" | "domcontentloaded" | "networkidle") {
                        return Err(
                            "loadState must be one of: load, domcontentloaded, networkidle"
                                .to_string(),
                        );
                    }
                    out.push("--load".to_string());
                    out.push(state);
                }
                _ => {
                    return Err(
                        "waitMode must be one of: selector, ms, text, url, load".to_string()
                    );
                }
            }
        }
        "get" => {
            out.push("get".to_string());
            let kind = arg_str_any(args, &["getKind", "kind"])
                .ok_or_else(|| "get requires getKind".to_string())?
                .to_ascii_lowercase();

            match kind.as_str() {
                "title" | "url" => {
                    out.push(kind);
                }
                "text" | "html" | "value" | "count" | "box" => {
                    out.push(kind);
                    out.push(required_selector(args, "get")?.to_string());
                }
                "attr" => {
                    out.push(kind);
                    out.push(required_selector(args, "get attr")?.to_string());
                    let attr_name = arg_str(args, "attrName")
                        .ok_or_else(|| "get attr requires attrName".to_string())?;
                    out.push(attr_name.to_string());
                }
                _ => {
                    return Err(
                        "getKind must be one of: text, html, value, attr, title, url, count, box"
                            .to_string(),
                    );
                }
            }
        }
        "screenshot" => {
            out.push("screenshot".to_string());
            if let Some(path) = arg_str_any(args, &["screenshotPath", "path"]) {
                out.push(path.to_string());
            }
            if arg_bool_any(args, &["screenshotFull", "full"], false) {
                out.push("--full".to_string());
            }
        }
        "tab" => {
            out.push("tab".to_string());
            let tab_mode = arg_str_any(args, &["tabMode", "mode"])
                .unwrap_or("list")
                .to_ascii_lowercase();
            match tab_mode.as_str() {
                "list" => {}
                "new" => {
                    out.push("new".to_string());
                    if let Some(tab_url) = arg_str_any(args, &["tabUrl", "url", "value"]) {
                        validate_http_url(tab_url)?;
                        out.push(tab_url.to_string());
                    }
                }
                "switch" => {
                    let idx = arg_u64_any(args, &["tabIndex", "index", "value"])
                        .ok_or_else(|| "tab switch mode requires tabIndex".to_string())?;
                    out.push(idx.to_string());
                }
                "close" => {
                    out.push("close".to_string());
                    if let Some(idx) = arg_u64_any(args, &["tabIndex", "index", "value"]) {
                        out.push(idx.to_string());
                    }
                }
                _ => {
                    return Err("tabMode must be one of: list, new, switch, close".to_string());
                }
            }
        }
        "close" => {
            out.push("close".to_string());
        }
        _ => {
            return Err(
                "action must be one of: open, snapshot, click, fill, type, press, wait, get, tab, screenshot, close"
                    .to_string(),
            );
        }
    }

    Ok(out)
}

fn required_selector<'a>(args: &'a Value, action: &str) -> Result<&'a str, String> {
    arg_str(args, "selector").ok_or_else(|| format!("{} requires selector", action))
}

fn validate_http_url(raw: &str) -> Result<(), String> {
    let parsed = Url::parse(raw).map_err(|e| format!("invalid url: {}", e))?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        _ => Err("only http:// and https:// URLs are allowed".to_string()),
    }
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn arg_str_any<'a>(args: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| arg_str(args, k))
}

fn arg_bool_any(args: &Value, keys: &[&str], default: bool) -> bool {
    keys.iter()
        .find_map(|k| args.get(k).and_then(|v| v.as_bool()))
        .unwrap_or(default)
}

fn arg_u64_any(args: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|k| {
        let v = args.get(k)?;
        if let Some(n) = v.as_u64() {
            return Some(n);
        }
        if let Some(n) = v.as_i64() {
            if n >= 0 {
                return Some(n as u64);
            }
        }
        if let Some(n) = v.as_f64() {
            if n.is_finite() && n >= 0.0 {
                return Some(n.round() as u64);
            }
        }
        None
    })
}

fn summarize_response_content(action: &str, data: &Value) -> String {
    if action == "snapshot" {
        if let Some(snapshot) = data.get("snapshot").and_then(|v| v.as_str()) {
            let (text, _) = truncate_to_chars(snapshot, MAX_RESPONSE_CHARS);
            return text;
        }
    }

    let pretty = serde_json::to_string_pretty(data).unwrap_or_else(|_| data.to_string());
    let (text, _) = truncate_to_chars(&pretty, MAX_RESPONSE_CHARS);
    text
}

fn value_kind(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn truncate_to_chars(input: &str, max_chars: usize) -> (String, bool) {
    if max_chars == 0 {
        return (String::new(), !input.is_empty());
    }
    let mut out = String::new();
    for (i, ch) in input.chars().enumerate() {
        if i >= max_chars {
            return (out, true);
        }
        out.push(ch);
    }
    (out, false)
}

fn render_command_for_log(args: &[String]) -> Vec<String> {
    args.iter().map(|a| redact_cli_value(a)).collect()
}

fn render_command_for_log_line(args: &[String]) -> String {
    render_command_for_log(args).join(" ")
}

fn tools_debug_enabled() -> bool {
    std::env::var("INFLOW_DEBUG_TOOLS").ok().as_deref() == Some("1")
}

fn redact_cli_value(v: &str) -> String {
    if v.starts_with("http://") || v.starts_with("https://") {
        if let Ok(url) = Url::parse(v) {
            return redact_url(url);
        }
    }
    v.to_string()
}

fn redact_url(mut url: Url) -> String {
    if let Some(query) = url.query() {
        let mut out_pairs: Vec<String> = Vec::new();
        for part in query.split('&') {
            if part.is_empty() {
                continue;
            }
            let (k, v) = match part.split_once('=') {
                Some((k, v)) => (k, Some(v)),
                None => (part, None),
            };
            let k_l = k.to_ascii_lowercase();
            let redact = k_l.contains("apikey")
                || k_l.contains("api_key")
                || k_l.contains("token")
                || k_l.contains("secret")
                || k_l.ends_with("key");
            if redact {
                out_pairs.push(format!("{}=<redacted>", k));
            } else if let Some(v) = v {
                out_pairs.push(format!("{}={}", k, v));
            } else {
                out_pairs.push(k.to_string());
            }
        }
        url.set_query(Some(&out_pairs.join("&")));
    }
    url.to_string()
}

pub fn spec() -> BuiltinToolSpec {
    BuiltinToolSpec {
        fn_name: TOOL_AGENT_BROWSER,
        title: "Agent Browser",
        description: Some(
            "Browser automation with safe action subset (includes tab; no eval/profile).",
        ),
        build,
        exec,
    }
}
