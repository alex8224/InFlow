use crate::config::LlmProvider;
use genai::Client;

pub fn build_genai_client(provider: &LlmProvider) -> Result<Client, String> {
    if provider.api_key.trim().is_empty() {
        return Err("请先在设置中配置 API Key".to_string());
    }

    let api_key = provider.api_key.clone();
    let auth_resolver = genai::resolver::AuthResolver::from_resolver_fn(move |_| {
        Ok(Some(genai::resolver::AuthData::from_single(
            api_key.clone(),
        )))
    });

    let mut builder = Client::builder().with_auth_resolver(auth_resolver);

    if let Some(url) = provider.base_url.as_ref() {
        if !url.trim().is_empty() {
            let api_key_for_service = provider.api_key.clone();
            let mut final_url = url.trim().to_string();
            if !final_url.ends_with('/') {
                final_url.push('/');
            }

            builder =
                builder.with_service_target_resolver_fn(move |mut target: genai::ServiceTarget| {
                    target.endpoint = genai::resolver::Endpoint::from_owned(final_url.clone());
                    target.auth =
                        genai::resolver::AuthData::from_single(api_key_for_service.clone());
                    Ok(target)
                });
        }
    }

    Ok(builder.build())
}

pub fn resolve_genai_model(provider: &LlmProvider) -> String {
    let kind_lower = provider.kind.to_lowercase();
    if provider.model_id.starts_with('/') {
        provider.model_id[1..].to_string()
    } else if provider.model_id.contains('/') {
        provider.model_id.clone()
    } else {
        format!("{}/{}", kind_lower, provider.model_id)
    }
}

pub fn strip_system_reminder(mut s: String) -> String {
    let start_tag = "<system-reminder>";
    let end_tag = "</system-reminder>";
    loop {
        let start = match s.find(start_tag) {
            Some(i) => i,
            None => break,
        };
        let end = match s[start + start_tag.len()..].find(end_tag) {
            Some(j) => start + start_tag.len() + j + end_tag.len(),
            None => s.len(),
        };
        s.replace_range(start..end, "");
    }
    s
}

pub fn json_schema_strip_keys(value: &serde_json::Value, keys: &[&str]) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map {
                if keys.iter().any(|x| *x == k.as_str()) {
                    continue;
                }
                out.insert(k.clone(), json_schema_strip_keys(v, keys));
            }
            serde_json::Value::Object(out)
        }
        serde_json::Value::Array(arr) => serde_json::Value::Array(
            arr.iter()
                .map(|v| json_schema_strip_keys(v, keys))
                .collect(),
        ),
        _ => value.clone(),
    }
}

pub fn json_value_contains_key(value: &serde_json::Value, needle: &str) -> bool {
    match value {
        serde_json::Value::Object(map) => {
            if map.contains_key(needle) {
                return true;
            }
            map.values().any(|v| json_value_contains_key(v, needle))
        }
        serde_json::Value::Array(arr) => arr.iter().any(|v| json_value_contains_key(v, needle)),
        _ => false,
    }
}

pub fn sanitize_tool_schema_for_provider(
    provider: &LlmProvider,
    schema: &serde_json::Value,
) -> serde_json::Value {
    // Several LLM tool/function APIs reject JSON Schema meta fields like `$schema`.
    // Gemini is strict and will 400 on unknown fields.
    let mut cleaned = json_schema_strip_keys(schema, &["$schema", "$id"]);

    // If the schema contains `$ref`, many hosted tool APIs (Gemini included) do not support it.
    // Rather than hard-fail the whole chat request, degrade to a permissive object schema.
    let kind = provider.kind.to_lowercase();
    if kind == "gemini" && json_value_contains_key(&cleaned, "$ref") {
        println!(
            "[mcp][schema] provider=gemini tool schema contains $ref; falling back to permissive object schema"
        );
        cleaned = serde_json::json!({ "type": "object", "additionalProperties": true });
    }

    cleaned
}
