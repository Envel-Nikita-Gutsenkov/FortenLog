# --- Build Stage ---
FROM rust:1.89-alpine as builder

WORKDIR /usr/src/fortenlog

# Install build dependencies on Alpine (musl-based)
RUN apk add --no-cache \
    musl-dev \
    pkgconfig \
    openssl-dev \
    openssl-libs-static \
    gcc \
    make \
    g++ \
    sqlite-dev

# Copy the source and assets
COPY . .

# Build the application
RUN cargo build --release

# Create empty data directory for SQLite inside builder
RUN mkdir -p /app/data

# --- Runtime Stage ---
FROM alpine:3.20

WORKDIR /app

# Install runtime dependencies and curl for the healthcheck
RUN apk add --no-cache \
    libssl3 \
    libcrypto3 \
    ca-certificates \
    curl \
    sqlite

# Copy the binary from builder
COPY --from=builder /usr/src/fortenlog/target/release/forten_log /app/forten_log

# Copy data directory with correct ownership for nobody user (Alpine UID 65534)
COPY --from=builder --chown=nobody:nobody /app/data /app/data

# Run as nonroot nobody user
USER nobody

# Environment variables
ENV RUST_LOG=info
ENV FORTENLOG_DATABASE_URL=/app/data/fortenlog.db
ENV PORT=3000

# Expose the port
EXPOSE 3000

# Run the application
CMD ["/app/forten_log"]
