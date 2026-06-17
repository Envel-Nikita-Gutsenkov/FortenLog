#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // Fuzz path masking logic
    if let Ok(text) = std::str::from_utf8(data) {
        let _masked = forten_log::handlers::ingest::mask_os_paths(text);
    }
});
