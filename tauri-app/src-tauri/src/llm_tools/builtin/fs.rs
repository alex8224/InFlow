use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;

use futures::future::BoxFuture;
use genai::chat::Tool;

use crate::config::{AppConfig, LlmProvider};
use crate::genai_client::sanitize_tool_schema_for_provider;
use crate::llm_tools::ToolExecResult;
use crate::state::AppState;

use super::{BuiltinToolSpec, ToolCategory};

pub const TOOL_READ_FILE: &str = "inflow__read_file";
pub const TOOL_WRITE_FILE: &str = "inflow__write_file";
pub const TOOL_LIST_FILE: &str = "inflow__list_file";
pub const TOOL_GREP: &str = "inflow__grep";

const MAX_LINES: usize = 10000;
const MAX_GREP_MATCHES: usize = 1000;
const MAX_GREP_FILES: usize = 100;

fn validate_path(config: &AppConfig, path: &str) -> Result<std::path::PathBuf, String> {
    let allowed_dirs = config
        .fs_allowed_dirs
        .as_ref()
        .ok_or_else(|| "fs_allowed_dirs not configured".to_string())?;

    if allowed_dirs.is_empty() {
        return Err("fs_allowed_dirs is empty".to_string());
    }

    let input_path = Path::new(path);
    if input_path.is_absolute() {
        let canonical = input_path
            .canonicalize()
            .map_err(|e| format!("Failed to resolve path: {}", e))?;

        for dir in allowed_dirs {
            let allowed = Path::new(dir);
            let allowed_canonical = allowed
                .canonicalize()
                .map_err(|e| format!("Failed to resolve allowed dir {}: {}", dir, e))?;

            if canonical.starts_with(&allowed_canonical) {
                return Ok(canonical);
            }
        }
        Err("Path is not in allowed directories".to_string())
    } else {
        let resolved = input_path
            .canonicalize()
            .map_err(|e| format!("Failed to resolve path: {}", e))?;

        for dir in allowed_dirs {
            let allowed = Path::new(dir);
            let allowed_canonical = allowed
                .canonicalize()
                .map_err(|e| format!("Failed to resolve allowed dir {}: {}", dir, e))?;

            if resolved.starts_with(&allowed_canonical) {
                return Ok(resolved);
            }
        }
        Err("Path is not in allowed directories".to_string())
    }
}

fn build_read_file(provider: &LlmProvider) -> Tool {
    let schema = serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "path": {
                "type": "string",
                "description": "The path to the file to read"
            },
            "startLine": {
                "type": "integer",
                "description": "Start line number (1-indexed, inclusive). Defaults to 1.",
                "minimum": 1
            },
            "endLine": {
                "type": "integer",
                "description": "End line number (1-indexed, inclusive). Defaults to end of file.",
                "minimum": 1
            }
        },
        "required": ["path"]
    });
    let schema = sanitize_tool_schema_for_provider(provider, &schema);
    Tool::new(TOOL_READ_FILE)
        .with_description("Read file content with optional line range.")
        .with_schema(schema)
}

fn exec_read_file<'a>(
    _provider: &'a LlmProvider,
    config: &'a AppConfig,
    _state: &'a AppState,
    args: &'a serde_json::Value,
) -> BoxFuture<'a, Result<ToolExecResult, String>> {
    Box::pin(async move {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "path is required".to_string())?;

        let path = validate_path(config, path)?;
        let file = fs::File::open(&path).map_err(|e| format!("Failed to open file: {}", e))?;
        let reader = BufReader::new(file);

        let start_line = args
            .get("startLine")
            .and_then(|v| v.as_u64())
            .map(|n| n as usize)
            .unwrap_or(1);

        let end_line = args
            .get("endLine")
            .and_then(|v| v.as_u64())
            .map(|n| n as usize);

        let mut lines: Vec<String> = Vec::new();
        for (idx, line) in reader.lines().enumerate() {
            let line_num = idx + 1;
            if line_num >= start_line {
                if let Some(end) = end_line {
                    if line_num > end {
                        break;
                    }
                }
                if lines.len() >= MAX_LINES {
                    break;
                }
                lines.push(line.map_err(|e| format!("Failed to read line: {}", e))?);
            }
        }

        let content = serde_json::json!({
            "path": path.to_string_lossy(),
            "startLine": start_line,
            "endLine": end_line.unwrap_or(start_line + lines.len() - 1),
            "lines": lines.len(),
            "content": lines.join("\n")
        });

        let response_content = lines.join("\n");

        Ok(ToolExecResult {
            content,
            response_content,
        })
    })
}

pub fn spec_read_file() -> BuiltinToolSpec {
    BuiltinToolSpec {
        fn_name: TOOL_READ_FILE,
        title: "Read file",
        category: ToolCategory::FileSystem,
        description: Some("Read file content with optional line range."),
        build: build_read_file,
        exec: exec_read_file,
    }
}

fn build_write_file(provider: &LlmProvider) -> Tool {
    let schema = serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "path": {
                "type": "string",
                "description": "The path to the file to write"
            },
            "content": {
                "type": "string",
                "description": "The content to write to the file"
            },
            "startLine": {
                "type": "integer",
                "description": "Start line number (1-indexed). If not specified, the file will be overwritten entirely. If specified, content will be written starting from this line, overwriting existing content.",
                "minimum": 1
            }
        },
        "required": ["path", "content"]
    });
    let schema = sanitize_tool_schema_for_provider(provider, &schema);
    Tool::new(TOOL_WRITE_FILE)
        .with_description("Write content to a file with optional line range overwrite.")
        .with_schema(schema)
}

fn exec_write_file<'a>(
    _provider: &'a LlmProvider,
    config: &'a AppConfig,
    _state: &'a AppState,
    args: &'a serde_json::Value,
) -> BoxFuture<'a, Result<ToolExecResult, String>> {
    Box::pin(async move {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "path is required".to_string())?;

        let content = args
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "content is required".to_string())?;

        let path = validate_path(config, path)?;

        if !path.exists() {
            let parent = path.parent().ok_or_else(|| "Invalid path".to_string())?;
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        let start_line = args
            .get("startLine")
            .and_then(|v| v.as_u64())
            .map(|n| n as usize);

        if let Some(start) = start_line {
            let file = fs::File::open(&path);
            let mut lines: Vec<String> = if let Ok(file) = file {
                let reader = BufReader::new(file);
                reader
                    .lines()
                    .take(start - 1)
                    .filter_map(|l| l.ok())
                    .collect()
            } else {
                Vec::new()
            };

            let new_lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
            lines.extend(new_lines.clone());

            let mut file = fs::File::create(&path)
                .map_err(|e| format!("Failed to create file: {}", e))?;
            for line in &lines {
                writeln!(file, "{}", line).map_err(|e| format!("Failed to write: {}", e))?;
            }

            let content_json = serde_json::json!({
                "path": path.to_string_lossy(),
                "startLine": start,
                "linesWritten": new_lines.len(),
                "success": true
            });

            Ok(ToolExecResult {
                content: content_json,
                response_content: format!("Wrote {} lines to file starting at line {}", new_lines.len(), start),
            })
        } else {
            fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))?;

            let content_json = serde_json::json!({
                "path": path.to_string_lossy(),
                "bytesWritten": content.len(),
                "success": true
            });

            Ok(ToolExecResult {
                content: content_json,
                response_content: format!("Wrote {} bytes to file", content.len()),
            })
        }
    })
}

pub fn spec_write_file() -> BuiltinToolSpec {
    BuiltinToolSpec {
        fn_name: TOOL_WRITE_FILE,
        title: "Write file",
        category: ToolCategory::FileSystem,
        description: Some("Write content to a file with optional line range overwrite."),
        build: build_write_file,
        exec: exec_write_file,
    }
}

fn build_list_file(provider: &LlmProvider) -> Tool {
    let schema = serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "path": {
                "type": "string",
                "description": "The path to the directory to list"
            },
            "recursive": {
                "type": "boolean",
                "description": "Whether to recursively list subdirectories. Defaults to false.",
                "default": false
            }
        },
        "required": ["path"]
    });
    let schema = sanitize_tool_schema_for_provider(provider, &schema);
    Tool::new(TOOL_LIST_FILE)
        .with_description("List files and directories with optional recursive traversal.")
        .with_schema(schema)
}

fn list_dir_recursive(path: &Path, depth: usize, max_depth: usize) -> Result<Vec<serde_json::Value>, String> {
    if depth > max_depth {
        return Ok(Vec::new());
    }

    let mut entries: Vec<serde_json::Value> = Vec::new();
    let dir = fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in dir {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let entry_path = entry.path();
        let metadata = entry.metadata().map_err(|e| format!("Failed to get metadata: {}", e))?;

        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = metadata.is_dir();

        entries.push(serde_json::json!({
            "name": name,
            "path": entry_path.to_string_lossy(),
            "isDirectory": is_dir,
            "size": if is_dir { serde_json::Value::Null } else { serde_json::json!(metadata.len()) }
        }));

        if is_dir && depth < max_depth {
            let sub_entries = list_dir_recursive(&entry_path, depth + 1, max_depth)?;
            entries.extend(sub_entries);
        }
    }

    Ok(entries)
}

fn exec_list_file<'a>(
    _provider: &'a LlmProvider,
    config: &'a AppConfig,
    _state: &'a AppState,
    args: &'a serde_json::Value,
) -> BoxFuture<'a, Result<ToolExecResult, String>> {
    Box::pin(async move {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "path is required".to_string())?;

        let recursive = args
            .get("recursive")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let path = validate_path(config, path)?;

        if !path.is_dir() {
            return Err("Path is not a directory".to_string());
        }

        let entries = if recursive {
            list_dir_recursive(&path, 0, 3)?
        } else {
            let mut entries: Vec<serde_json::Value> = Vec::new();
            let dir = fs::read_dir(&path).map_err(|e| format!("Failed to read directory: {}", e))?;

            for entry in dir {
                let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
                let entry_path = entry.path();
                let metadata = entry.metadata().map_err(|e| format!("Failed to get metadata: {}", e))?;

                let name = entry.file_name().to_string_lossy().to_string();
                let is_dir = metadata.is_dir();

                entries.push(serde_json::json!({
                    "name": name,
                    "path": entry_path.to_string_lossy(),
                    "isDirectory": is_dir,
                    "size": if is_dir { serde_json::Value::Null } else { serde_json::json!(metadata.len()) }
                }));
            }
            entries
        };

        let content = serde_json::json!({
            "path": path.to_string_lossy(),
            "entries": entries,
            "count": entries.len()
        });

        let response_content = serde_json::to_string_pretty(&entries)
            .unwrap_or_else(|_| entries.len().to_string());

        Ok(ToolExecResult {
            content,
            response_content,
        })
    })
}

pub fn spec_list_file() -> BuiltinToolSpec {
    BuiltinToolSpec {
        fn_name: TOOL_LIST_FILE,
        title: "List files",
        category: ToolCategory::FileSystem,
        description: Some("List files and directories with optional recursive traversal."),
        build: build_list_file,
        exec: exec_list_file,
    }
}

fn build_grep(provider: &LlmProvider) -> Tool {
    let schema = serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "path": {
                "type": "string",
                "description": "The file or directory path to search in"
            },
            "pattern": {
                "type": "string",
                "description": "The regex pattern to search for"
            },
            "filePattern": {
                "type": "string",
                "description": "Optional file name pattern (e.g., '*.rs', '*.ts'). Only applies when searching directories."
            },
            "context": {
                "type": "integer",
                "description": "Number of context lines before and after each match. Defaults to 3.",
                "default": 3,
                "minimum": 0,
                "maximum": 10
            },
            "caseSensitive": {
                "type": "boolean",
                "description": "Whether the search is case sensitive. Defaults to false.",
                "default": false
            }
        },
        "required": ["path", "pattern"]
    });
    let schema = sanitize_tool_schema_for_provider(provider, &schema);
    Tool::new(TOOL_GREP)
        .with_description("Search for patterns in files using regex.")
        .with_schema(schema)
}

struct GrepMatch {
    file: String,
    line: usize,
    content: String,
    line_content: String,
    context_before: Vec<String>,
    context_after: Vec<String>,
}

fn grep_file(
    path: &Path,
    pattern: &str,
    case_sensitive: bool,
    context: usize,
    matches: &mut Vec<GrepMatch>,
) -> Result<(), String> {
    let file_content = fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;
    let lines: Vec<&str> = file_content.lines().collect();

    let regex_pattern = if case_sensitive {
        pattern.to_string()
    } else {
        format!("(?i){}", pattern)
    };

    let re = regex::Regex::new(&regex_pattern)
        .map_err(|e| format!("Invalid regex pattern: {}", e))?;

    for (idx, line) in lines.iter().enumerate() {
        if matches.len() >= MAX_GREP_MATCHES {
            break;
        }

        if let Some(m) = re.find(line) {
            let line_num = idx + 1;
            let start = m.start();
            let end = m.end();

            let line_content = line.to_string();
            let matched_text = &line_content[start..end];

            let context_before: Vec<String> = (1..=context)
                .map(|i| idx + 1 - i)
                .filter(|&i| i > 0)
                .rev()
                .filter_map(|i| lines.get(i - 1).map(|s| s.to_string()))
                .collect();

            let context_after: Vec<String> = (1..=context)
                .map(|i| idx + 1 + i)
                .filter(|&i| i <= lines.len())
                .filter_map(|i| lines.get(i - 1).map(|s| s.to_string()))
                .collect();

            matches.push(GrepMatch {
                file: path.to_string_lossy().to_string(),
                line: line_num,
                content: matched_text.to_string(),
                line_content,
                context_before,
                context_after,
            });
        }
    }

    Ok(())
}

fn grep_dir(
    dir: &Path,
    pattern: &str,
    file_pattern: Option<&str>,
    case_sensitive: bool,
    context: usize,
    matches: &mut Vec<GrepMatch>,
    files_checked: &mut usize,
) -> Result<(), String> {
    if *files_checked >= MAX_GREP_FILES {
        return Ok(());
    }

    let dir_entries = fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in dir_entries {
        if *files_checked >= MAX_GREP_FILES {
            break;
        }

        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let entry_path = entry.path();
        let metadata = entry.metadata().map_err(|e| format!("Failed to get metadata: {}", e))?;

        if metadata.is_dir() {
            grep_dir(&entry_path, pattern, file_pattern, case_sensitive, context, matches, files_checked)?;
        } else if metadata.is_file() {
            if let Some(fp) = file_pattern {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if !match_glob(&name_str, fp) {
                    continue;
                }
            }

            *files_checked += 1;
            grep_file(&entry_path, pattern, case_sensitive, context, matches)?;
        }
    }

    Ok(())
}

fn match_glob(name: &str, pattern: &str) -> bool {
    let pattern = pattern.replace(".", "\\.");
    let pattern = pattern.replace("*", ".*");
    let regex_pattern = format!("^{}$", pattern);

    regex::Regex::new(&regex_pattern)
        .map(|re| re.is_match(name))
        .unwrap_or(false)
}

fn exec_grep<'a>(
    _provider: &'a LlmProvider,
    config: &'a AppConfig,
    _state: &'a AppState,
    args: &'a serde_json::Value,
) -> BoxFuture<'a, Result<ToolExecResult, String>> {
    Box::pin(async move {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "path is required".to_string())?;

        let pattern = args
            .get("pattern")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "pattern is required".to_string())?;

        let file_pattern = args
            .get("filePattern")
            .and_then(|v| v.as_str());

        let context = args
            .get("context")
            .and_then(|v| v.as_u64())
            .map(|n| n as usize)
            .unwrap_or(3)
            .min(10);

        let case_sensitive = args
            .get("caseSensitive")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let path = validate_path(config, path)?;

        let mut matches: Vec<GrepMatch> = Vec::new();
        let mut files_checked: usize = 0;

        if path.is_dir() {
            grep_dir(
                &path,
                pattern,
                file_pattern,
                case_sensitive,
                context,
                &mut matches,
                &mut files_checked,
            )?;
        } else if path.is_file() {
            files_checked = 1;
            grep_file(&path, pattern, case_sensitive, context, &mut matches)?;
        } else {
            return Err("Path is neither a file nor a directory".to_string());
        }

        let matches_json: Vec<serde_json::Value> = matches
            .iter()
            .map(|m| {
                serde_json::json!({
                    "file": m.file,
                    "line": m.line,
                    "content": m.content,
                    "lineContent": m.line_content,
                    "contextBefore": m.context_before,
                    "contextAfter": m.context_after
                })
            })
            .collect();

        let content = serde_json::json!({
            "path": path.to_string_lossy(),
            "pattern": pattern,
            "matches": matches_json,
            "stats": {
                "filesMatched": matches.iter().map(|m| &m.file).collect::<std::collections::HashSet<_>>().len(),
                "totalMatches": matches.len(),
                "filesChecked": files_checked
            }
        });

        let response_content = serde_json::to_string_pretty(&matches_json)
            .unwrap_or_else(|_| format!("Found {} matches", matches.len()));

        Ok(ToolExecResult {
            content,
            response_content,
        })
    })
}

pub fn spec_grep() -> BuiltinToolSpec {
    BuiltinToolSpec {
        fn_name: TOOL_GREP,
        title: "Grep",
        category: ToolCategory::FileSystem,
        description: Some("Search for patterns in files using regex."),
        build: build_grep,
        exec: exec_grep,
    }
}
