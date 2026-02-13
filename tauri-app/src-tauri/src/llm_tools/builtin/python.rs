use futures::future::BoxFuture;
use genai::chat::Tool;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;

use crate::config::{AppConfig, LlmProvider};
use crate::genai_client::sanitize_tool_schema_for_provider;
use crate::llm_tools::ToolExecResult;
use crate::state::AppState;

use super::{BuiltinToolSpec, ToolCategory};

pub const TOOL_PYTHON_EXECUTE: &str = "inflow__python_execute";
pub const TOOL_PYTHON_TEST: &str = "inflow__python_test";
pub const TOOL_PYTHON_FORMAT: &str = "inflow__python_format";
pub const TOOL_PYTHON_LINT: &str = "inflow__python_lint";

const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_TIMEOUT_SECS: u64 = 120;
const MAX_OUTPUT_SIZE: usize = 10 * 1024 * 1024; // 10MB

fn find_python_executable() -> Result<String, String> {
    let candidates = ["python3", "python"];
    for cmd in candidates {
        if let Ok(output) = Command::new(cmd).arg("--version").output() {
            if output.status.success() {
                return Ok(cmd.to_string());
            }
        }
    }
    Err("Python interpreter not found. Please ensure python3 or python is installed and available in PATH.".to_string())
}

fn write_temp_file(code: &str) -> Result<PathBuf, String> {
    let mut temp_file = std::env::temp_dir();
    temp_file.push(format!("inflow_python_{}.py", std::process::id()));
    
    let mut file = std::fs::File::create(&temp_file)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    
    file.write_all(code.as_bytes())
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    
    Ok(temp_file)
}

fn truncate_output(output: &str) -> String {
    if output.len() > MAX_OUTPUT_SIZE {
        format!(
            "{}\n\n[Output truncated: {} bytes, showing first {}]",
            &output[..MAX_OUTPUT_SIZE],
            output.len(),
            MAX_OUTPUT_SIZE
        )
    } else {
        output.to_string()
    }
}

fn build_python_execute(provider: &LlmProvider) -> Tool {
    let schema = serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "code": {
                "type": "string",
                "description": "Python code to execute"
            },
            "timeout": {
                "type": "number",
                "description": "Timeout in seconds (max 120)",
                "default": 30,
                "minimum": 1,
                "maximum": 120
            },
            "captureStderr": {
                "type": "boolean",
                "description": "Whether to capture stderr output",
                "default": true
            }
        },
        "required": ["code"]
    });
    let schema = sanitize_tool_schema_for_provider(provider, &schema);
    Tool::new(TOOL_PYTHON_EXECUTE)
        .with_description("Execute Python code and return stdout/stderr")
        .with_schema(schema)
}

fn exec_python_execute<'a>(
    _provider: &'a LlmProvider,
    _config: &'a AppConfig,
    _state: &'a AppState,
    args: &'a serde_json::Value,
) -> BoxFuture<'a, Result<ToolExecResult, String>> {
    Box::pin(async move {
        let code = args
            .get("code")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "code is required".to_string())?;

        let timeout_secs = args
            .get("timeout")
            .and_then(|v| v.as_f64())
            .map(|n| n.max(1.0).min(120.0) as u64)
            .unwrap_or(DEFAULT_TIMEOUT_SECS);

        let capture_stderr = args
            .get("captureStderr")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let python = find_python_executable()?;

        let start = std::time::Instant::now();
        let output = Command::new(&python)
            .arg("-c")
            .arg(code)
            .output()
            .map_err(|e| format!("Failed to execute Python: {}", e))?;

        let elapsed = start.elapsed().as_secs_f64();

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        let content = serde_json::json!({
            "success": output.status.success(),
            "exitCode": output.status.code().unwrap_or(-1),
            "stdout": truncate_output(&stdout),
            "stderr": if capture_stderr { truncate_output(&stderr) } else { String::new() },
            "duration": elapsed,
            "interpreter": python
        });

        let response_content = if output.status.success() {
            truncate_output(&stdout)
        } else {
            format!("Exit code: {}\nStderr: {}", output.status.code().unwrap_or(-1), truncate_output(&stderr))
        };

        Ok(ToolExecResult {
            content,
            response_content,
        })
    })
}

fn build_python_test(provider: &LlmProvider) -> Tool {
    let schema = serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "code": {
                "type": "string",
                "description": "Python code containing pytest tests"
            },
            "timeout": {
                "type": "number",
                "description": "Timeout in seconds (max 120)",
                "default": 30,
                "minimum": 1,
                "maximum": 120
            }
        },
        "required": ["code"]
    });
    let schema = sanitize_tool_schema_for_provider(provider, &schema);
    Tool::new(TOOL_PYTHON_TEST)
        .with_description("Run pytest on Python code and return test results")
        .with_schema(schema)
}

fn exec_python_test<'a>(
    _provider: &'a LlmProvider,
    _config: &'a AppConfig,
    _state: &'a AppState,
    args: &'a serde_json::Value,
) -> BoxFuture<'a, Result<ToolExecResult, String>> {
    Box::pin(async move {
        let code = args
            .get("code")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "code is required".to_string())?;

        let timeout_secs = args
            .get("timeout")
            .and_then(|v| v.as_f64())
            .map(|n| n.max(1.0).min(120.0) as u64)
            .unwrap_or(DEFAULT_TIMEOUT_SECS);

        let python = find_python_executable()?;
        let temp_file = write_temp_file(code)?;

        let start = std::time::Instant::now();
        let output = Command::new(&python)
            .arg("-m")
            .arg("pytest")
            .arg("-v")
            .arg("--tb=short")
            .arg(&temp_file)
            .output();

        let _ = std::fs::remove_file(&temp_file);

        let output = output.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "pytest module not found. Install with: pip install pytest".to_string()
            } else {
                format!("Failed to execute pytest: {}", e)
            }
        })?;

        let elapsed = start.elapsed().as_secs_f64();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        let success = output.status.success();

        let content = serde_json::json!({
            "success": success,
            "exitCode": output.status.code().unwrap_or(-1),
            "output": stdout,
            "stderr": stderr,
            "duration": elapsed,
            "interpreter": python
        });

        let response_content = if success {
            format!("Tests passed ({}s)", elapsed)
        } else {
            format!("Tests failed ({}s)\n{}", elapsed, truncate_output(&stdout))
        };

        Ok(ToolExecResult {
            content,
            response_content,
        })
    })
}

fn build_python_format(provider: &LlmProvider) -> Tool {
    let schema = serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "code": {
                "type": "string",
                "description": "Python code to format"
            },
            "lineLength": {
                "type": "integer",
                "description": "Maximum line length",
                "default": 88,
                "minimum": 50,
                "maximum": 200
            }
        },
        "required": ["code"]
    });
    let schema = sanitize_tool_schema_for_provider(provider, &schema);
    Tool::new(TOOL_PYTHON_FORMAT)
        .with_description("Format Python code using black formatter")
        .with_schema(schema)
}

fn exec_python_format<'a>(
    _provider: &'a LlmProvider,
    _config: &'a AppConfig,
    _state: &'a AppState,
    args: &'a serde_json::Value,
) -> BoxFuture<'a, Result<ToolExecResult, String>> {
    Box::pin(async move {
        let code = args
            .get("code")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "code is required".to_string())?;

        let line_length = args
            .get("lineLength")
            .and_then(|v| v.as_i64())
            .map(|n| n.max(50).min(200))
            .unwrap_or(88);

        let python = find_python_executable()?;
        let temp_file = write_temp_file(code)?;

        let output = Command::new(&python)
            .arg("-m")
            .arg("black")
            .arg("--line-length")
            .arg(line_length.to_string())
            .arg("--stdin-filename")
            .arg("temp.py")
            .arg("--code")
            .arg(code)
            .output();

        let _ = std::fs::remove_file(&temp_file);

        let output = output.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "black formatter not found. Install with: pip install black".to_string()
            } else {
                format!("Failed to execute black: {}", e)
            }
        })?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if output.status.success() && !stdout.trim().is_empty() {
            let content = serde_json::json!({
                "success": true,
                "formattedCode": stdout,
                "originalCode": code,
                "lineLength": line_length
            });

            Ok(ToolExecResult {
                content,
                response_content: stdout,
            })
        } else {
            Err(if !stderr.is_empty() {
                stderr
            } else {
                "Failed to format code".to_string()
            })
        }
    })
}

fn build_python_lint(provider: &LlmProvider) -> Tool {
    let schema = serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "code": {
                "type": "string",
                "description": "Python code to lint"
            },
            "maxLineLength": {
                "type": "integer",
                "description": "Maximum line length",
                "default": 88,
                "minimum": 50,
                "maximum": 200
            }
        },
        "required": ["code"]
    });
    let schema = sanitize_tool_schema_for_provider(provider, &schema);
    Tool::new(TOOL_PYTHON_LINT)
        .with_description("Lint Python code using flake8")
        .with_schema(schema)
}

fn exec_python_lint<'a>(
    _provider: &'a LlmProvider,
    _config: &'a AppConfig,
    _state: &'a AppState,
    args: &'a serde_json::Value,
) -> BoxFuture<'a, Result<ToolExecResult, String>> {
    Box::pin(async move {
        let code = args
            .get("code")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "code is required".to_string())?;

        let max_line_length = args
            .get("maxLineLength")
            .and_then(|v| v.as_i64())
            .map(|n| n.max(50).min(200))
            .unwrap_or(88);

        let python = find_python_executable()?;
        let temp_file = write_temp_file(code)?;

        let output = Command::new(&python)
            .arg("-m")
            .arg("flake8")
            .arg("--max-line-length")
            .arg(max_line_length.to_string())
            .arg(&temp_file)
            .output();

        let _ = std::fs::remove_file(&temp_file);

        let output = output.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "flake8 linter not found. Install with: pip install flake8".to_string()
            } else {
                format!("Failed to execute flake8: {}", e)
            }
        })?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        let success = output.status.success() && stdout.trim().is_empty();

        let content = serde_json::json!({
            "success": success,
            "issues": if stdout.trim().is_empty() { std::vec::Vec::new() } else {
                stdout.lines().map(|s| s.to_string()).collect::<std::vec::Vec<_>>()
            },
            "stderr": stderr,
            "maxLineLength": max_line_length
        });

        let response_content = if success {
            "No linting issues found".to_string()
        } else {
            format!("Linting issues:\n{}", stdout)
        };

        Ok(ToolExecResult {
            content,
            response_content,
        })
    })
}

pub fn spec_python_execute() -> BuiltinToolSpec {
    BuiltinToolSpec {
        fn_name: TOOL_PYTHON_EXECUTE,
        title: "Python execute",
        category: ToolCategory::Developer,
        description: Some("Execute Python code"),
        build: build_python_execute,
        exec: exec_python_execute,
    }
}

pub fn spec_python_test() -> BuiltinToolSpec {
    BuiltinToolSpec {
        fn_name: TOOL_PYTHON_TEST,
        title: "Python test",
        category: ToolCategory::Developer,
        description: Some("Run pytest on Python code"),
        build: build_python_test,
        exec: exec_python_test,
    }
}

pub fn spec_python_format() -> BuiltinToolSpec {
    BuiltinToolSpec {
        fn_name: TOOL_PYTHON_FORMAT,
        title: "Python format",
        category: ToolCategory::Developer,
        description: Some("Format Python code with black"),
        build: build_python_format,
        exec: exec_python_format,
    }
}

pub fn spec_python_lint() -> BuiltinToolSpec {
    BuiltinToolSpec {
        fn_name: TOOL_PYTHON_LINT,
        title: "Python lint",
        category: ToolCategory::Developer,
        description: Some("Lint Python code with flake8"),
        build: build_python_lint,
        exec: exec_python_lint,
    }
}
