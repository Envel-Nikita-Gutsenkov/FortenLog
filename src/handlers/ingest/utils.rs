use serde_json::Value;
use sha2::{Sha256, Digest};

pub fn calculate_hash(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

pub fn resolve_region(ip: &Option<String>) -> Option<String> {
    let ip = match ip {
        Some(s) => s,
        None => return Some("US".to_string()),
    };
    if ip.starts_with("127.") || ip == "::1" || ip == "localhost" {
        return Some("US".to_string()); // Default local testing to US to avoid Russia dominance
    }
    let sum: u8 = ip.split('.').filter_map(|s| s.parse::<u8>().ok()).sum();
    match sum % 16 {
        0 => Some("US".to_string()),
        1 => Some("DE".to_string()),
        2 => Some("GB".to_string()),
        3 => Some("FR".to_string()),
        4 => Some("JP".to_string()),
        5 => Some("IN".to_string()),
        6 => Some("BR".to_string()),
        7 => Some("AU".to_string()),
        8 => Some("CA".to_string()),
        9 => Some("UA".to_string()),
        10 => Some("KZ".to_string()),
        11 => Some("BY".to_string()),
        12 => Some("NL".to_string()),
        13 => Some("IT".to_string()),
        14 => Some("ES".to_string()),
        15 => Some("SE".to_string()),
        _ => Some("US".to_string()),
    }
}

pub fn mask_os_paths(text: &str) -> String {
    let mut result = text.to_string();
    
    // Mask Windows \Users\<Name>\
    let mut search_start = 0;
    while let Some(idx) = result[search_start..].find("\\Users\\") {
        let absolute_idx = search_start + idx;
        let start = absolute_idx + 7;
        if let Some(end) = result[start..].find('\\') {
            result.replace_range(start..start+end, "***");
            search_start = start + 3;
        } else {
            result.replace_range(start.., "***");
            break;
        }
    }
    // Mask macOS /Users/<Name>/
    let mut search_start = 0;
    while let Some(idx) = result[search_start..].find("/Users/") {
        let absolute_idx = search_start + idx;
        let start = absolute_idx + 7;
        if let Some(end) = result[start..].find('/') {
            result.replace_range(start..start+end, "***");
            search_start = start + 3;
        } else {
            result.replace_range(start.., "***");
            break;
        }
    }
    result
}

pub fn strip_pii(value: &mut Value) {
    if let Value::Object(map) = value {
        let pii_keys = ["password", "token", "secret", "email", "user_name", "full_name", "api_key"];
        for key in pii_keys {
            map.remove(key);
        }
        for v in map.values_mut() {
            strip_pii(v);
        }
    } else if let Value::Array(arr) = value {
        for v in arr.iter_mut() {
            strip_pii(v);
        }
    } else if let Value::String(s) = value {
        if s.contains("\\Users\\") || s.contains("/Users/") {
            *value = Value::String(mask_os_paths(s));
        }
    }
}

pub fn strip_volatile_analytics_fields(value: &mut Value) {
    if let Value::Object(map) = value {
        // Remove high-cardinality or volatile fields that break aggregation
        let volatile_keys = ["timestamp", "$time", "distinct_id", "session_id", "$session_id", "launcher_data_path", "ip", "uuid"];
        for key in volatile_keys {
            map.remove(key);
        }
        
        map.retain(|_, v| !v.is_null());
        
        for v in map.values_mut() {
            strip_volatile_analytics_fields(v);
        }
    } else if let Value::Array(arr) = value {
        for v in arr.iter_mut() {
            strip_volatile_analytics_fields(v);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_mask_os_paths() {
        let windows_path = "Error in C:\\Users\\User\\AppData\\Local\\Game\\config.json";
        assert_eq!(mask_os_paths(windows_path), "Error in C:\\Users\\***\\AppData\\Local\\Game\\config.json");

        let mac_path = "Failed at /Users/AdminUser/Library/Application Support/";
        assert_eq!(mask_os_paths(mac_path), "Failed at /Users/***/Library/Application Support/");
        
        let safe_path = "/var/log/syslog";
        assert_eq!(mask_os_paths(safe_path), "/var/log/syslog");
    }

    #[test]
    fn test_strip_pii() {
        let mut data = json!({
            "password": "secret_password",
            "email": "user@example.com",
            "safe_field": "hello",
            "file_path": "C:\\Users\\Bob\\Downloads\\test.txt",
            "nested": {
                "token": "12345",
                "nested_path": "/Users/Alice/Desktop/file.png"
            }
        });

        strip_pii(&mut data);

        assert_eq!(data["password"], serde_json::Value::Null);
        assert_eq!(data["email"], serde_json::Value::Null);
        assert_eq!(data["safe_field"], "hello");
        assert_eq!(data["file_path"], "C:\\Users\\***\\Downloads\\test.txt");
        assert_eq!(data["nested"]["token"], serde_json::Value::Null);
        assert_eq!(data["nested"]["nested_path"], "/Users/***/Desktop/file.png");
    }

    #[test]
    fn test_strip_volatile_analytics_fields() {
        let mut data = json!({
            "event": "button_click",
            "timestamp": "2023-10-01T12:00:00Z",
            "ip": "192.168.1.1",
            "distinct_id": "user_123",
            "properties": {
                "button_name": "checkout",
                "$session_id": "sess_abc123"
            }
        });

        strip_volatile_analytics_fields(&mut data);

        assert_eq!(data["event"], "button_click");
        assert_eq!(data["timestamp"], serde_json::Value::Null);
        assert_eq!(data["ip"], serde_json::Value::Null);
        assert_eq!(data["distinct_id"], serde_json::Value::Null);
        assert_eq!(data["properties"]["button_name"], "checkout");
        assert_eq!(data["properties"]["$session_id"], serde_json::Value::Null);
    }
}

pub fn normalize_os(os: Option<String>) -> Option<String> {
    let os_str = match os {
        Some(ref s) => s.trim().to_lowercase(),
        None => return None,
    };
    if os_str.contains("win") || os_str == "win32" || os_str == "win64" {
        Some("Windows".to_string())
    } else if os_str.contains("darwin") || os_str.contains("mac") || os_str.contains("os x") || os_str.contains("osx") || os_str.contains("apple") {
        Some("macOS".to_string())
    } else if os_str.contains("linux") || os_str.contains("ubuntu") || os_str.contains("debian") {
        Some("Linux".to_string())
    } else {
        if os_str.is_empty() {
            None
        } else {
            let mut chars = os_str.chars();
            match chars.next() {
                None => None,
                Some(f) => Some(f.to_uppercase().collect::<String>() + chars.as_str()),
            }
        }
    }
}

pub fn get_client_ip(headers: &axum::http::HeaderMap, socket_addr: &std::net::SocketAddr) -> String {
    // 1. Check CF-Connecting-IP (Cloudflare)
    if let Some(cf_ip) = headers.get("cf-connecting-ip").and_then(|v| v.to_str().ok()) {
        if let Ok(ip) = cf_ip.trim().parse::<std::net::IpAddr>() {
            return ip.to_string();
        }
    }

    // 2. Check X-Real-IP
    if let Some(real_ip) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        if let Ok(ip) = real_ip.trim().parse::<std::net::IpAddr>() {
            return ip.to_string();
        }
    }

    // 3. Check X-Forwarded-For
    if let Some(forwarded_for) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first_ip) = forwarded_for.split(',').next() {
            if let Ok(ip) = first_ip.trim().parse::<std::net::IpAddr>() {
                return ip.to_string();
            }
        }
    }

    // 4. Fallback to socket address
    socket_addr.ip().to_string()
}

