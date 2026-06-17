pub mod audit;
use serde::{Deserialize, Serialize};
use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey};
use chrono::{Utc, Duration};
use aes_gcm::{Aes256Gcm, Key, Nonce, KeyInit, aead::Aead};
use totp_rs::{Algorithm as TotpAlgo, TOTP};

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
}

pub fn create_jwt(user: &str, secret: &str) -> anyhow::Result<String> {
    let expiration = Utc::now()
        .checked_add_signed(Duration::hours(24))
        .expect("valid timestamp")
        .timestamp();

    let claims = Claims {
        sub: user.to_owned(),
        exp: expiration as usize,
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_ref()),
    )?;

    Ok(token)
}

pub fn validate_jwt(token: &str, secret: &str) -> anyhow::Result<Claims> {
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_ref()),
        &Validation::default(),
    )?;

    Ok(token_data.claims)
}

pub fn generate_totp_secret(user: &str) -> (String, String) {
    let secret = vec![0u8; 20];
    let totp = TOTP::new(
        TotpAlgo::SHA1,
        6,
        1,
        30,
        secret,
    ).expect("TOTP_CREATION_FAILED");
    
    let b32 = totp.get_secret_base32();
    let url = format!("otpauth://totp/FortenLog:{}?secret={}&issuer=FortenLog", user, b32);
    (b32, url)
}

pub fn verify_totp(secret_b32: &str, code: &str) -> bool {
    if let Ok(totp) = TOTP::new(
        TotpAlgo::SHA1,
        6,
        1,
        30,
        secret_b32.as_bytes().to_vec(),
    ) {
        totp.check_current(code).unwrap_or(false)
    } else {
        false
    }
}

pub fn encrypt_secret(data: &str, key: &str) -> Vec<u8> {
    let key_bytes = format!("{:.<32}", key);
    let key = Key::<Aes256Gcm>::from_slice(key_bytes.as_bytes());
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(b"unique_nonce");
    cipher.encrypt(nonce, data.as_bytes()).expect("encryption failure")
}

pub fn decrypt_secret(encrypted: &[u8], key: &str) -> String {
    let key_bytes = format!("{:.<32}", key);
    let key = Key::<Aes256Gcm>::from_slice(key_bytes.as_bytes());
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(b"unique_nonce");
    let decrypted = cipher.decrypt(nonce, encrypted).expect("decryption failure");
    String::from_utf8(decrypted).unwrap()
}
