use chrono::Duration;

pub fn validate_password_strength(password: &str) -> Result<(), String> {
    if password.len() < 12 {
        return Err("Password must be at least 12 characters long".into());
    }
    let has_upper = password.chars().any(|c| c.is_uppercase());
    let has_lower = password.chars().any(|c| c.is_lowercase());
    let has_digit = password.chars().any(|c| c.is_numeric());
    let has_special = password.chars().any(|c| !c.is_alphanumeric());

    if !has_upper || !has_lower || !has_digit || !has_special {
        return Err("Password must contain uppercase, lowercase, numbers, and special characters".into());
    }
    Ok(())
}

/// Computes the login tarpit delay for a given number of failed attempts.
///
/// Brute-force protection schedule:
///   Attempts 1–5:  no delay (free window)
///   Attempt 6–8:   2^1 =    2 s
///   Attempt 9–11:  2^2 =    4 s
///   Attempt 12–14: 2^3 =    8 s
///   Attempt 15–17: 2^4 =   16 s
///   Attempt 18–20: 2^5 =   32 s
///   Attempt 21–23: 2^6 =   64 s
///   Attempt 24–26: 2^7 =  128 s
///   Attempt 27–29: 2^8 =  256 s
///   Attempt 30+:   2^9 =  512 s  (capped at 1 h = 3600 s)
///
/// The delay is applied **as actual sleep in the HTTP response** (tarpit),
/// and also stored as `locked_until` in the DB to persist across restarts.
pub fn get_login_delay(failed_attempts: u32) -> Duration {
    if failed_attempts < 6 {
        return Duration::zero();
    }
    // Exponent steps every 3 attempts starting at attempt 6
    let exponent = ((failed_attempts - 6) / 3) + 1;
    let exponent = exponent.min(12); // 2^12 = 4096, which is already above the 3600 cap; prevents pow overflow
    let secs = (2u64.pow(exponent)).min(3600) as i64;
    Duration::seconds(secs)
}

pub fn send_security_alert(user: &str, ip: &str, action: &str) {
    // Mock implementation — replace with real SMTP/webhook integration in production
    tracing::info!(
        "[SECURITY_ALERT] [EMAIL_MOCK] To: {}@fortenlog.io | Action: {} | Source IP: {}",
        user, action, ip
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_login_delay_free_window() {
        for n in 0..=5 {
            assert_eq!(get_login_delay(n).num_seconds(), 0, "attempt {n} should have no delay");
        }
    }

    #[test]
    fn test_login_delay_exponential_steps() {
        assert_eq!(get_login_delay(6).num_seconds(), 2);
        assert_eq!(get_login_delay(7).num_seconds(), 2);
        assert_eq!(get_login_delay(8).num_seconds(), 2);
        assert_eq!(get_login_delay(9).num_seconds(), 4);
        assert_eq!(get_login_delay(11).num_seconds(), 4);
        assert_eq!(get_login_delay(12).num_seconds(), 8);
        assert_eq!(get_login_delay(15).num_seconds(), 16);
        assert_eq!(get_login_delay(18).num_seconds(), 32);
        assert_eq!(get_login_delay(21).num_seconds(), 64);
        assert_eq!(get_login_delay(24).num_seconds(), 128);
        assert_eq!(get_login_delay(27).num_seconds(), 256);
        assert_eq!(get_login_delay(30).num_seconds(), 512);
    }

    #[test]
    fn test_login_delay_cap() {
        // Very high attempt count must never exceed 1 hour
        assert!(get_login_delay(1000).num_seconds() <= 3600);
    }
}
