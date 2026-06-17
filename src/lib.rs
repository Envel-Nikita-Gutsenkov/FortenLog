extern crate rand;
pub mod auth;
pub mod db;
pub mod handlers;
pub mod middleware;
pub mod models;
pub mod ui;
pub mod security;

#[cfg(test)]
mod tests {
    use super::auth::*;
    use super::middleware::auth::mask_ip;
    use serde_json::json;

    #[test]
    fn test_pii_stripping() {
        let mut data = json!({
            "user": "testuser",
            "password": "secret_password",
            "nested": {
                "token": "token_val",
                "email": "test@example.com"
            }
        });
        super::handlers::ingest::strip_pii(&mut data);
        
        assert_eq!(data["user"], "testuser");
        assert!(data["password"].is_null());
        assert!(data["nested"]["token"].is_null());
        assert!(data["nested"]["email"].is_null());
    }

    #[test]
    fn test_ip_masking() {
        assert_eq!(mask_ip("192.168.1.45"), "192.168.1.0");
        assert_eq!(mask_ip("127.0.0.1"), "127.0.0.0");
    }

    #[test]
    fn test_jwt_flow() {
        let secret = "test_jwt_secret_32_chars_long_long";
        let token = create_jwt("admin", secret).unwrap();
        let claims = validate_jwt(&token, secret).unwrap();
        assert_eq!(claims.sub, "admin");
    }

    #[test]
    fn test_encryption_flow() {
        let secret = "super_secret_encryption_key_123";
        let data = "my_api_key_fl_12345";
        let encrypted = encrypt_secret(data, secret);
        let decrypted = decrypt_secret(&encrypted, secret);
        assert_eq!(data, decrypted);
    }
}
