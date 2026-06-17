fn main() {
    // Tell Cargo to re-run the build script if any file in the ui directory changes.
    // This ensures that rust-embed always packages the latest frontend files.
    println!("cargo:rerun-if-changed=ui");
}
