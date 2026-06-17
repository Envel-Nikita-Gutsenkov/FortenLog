#!/bin/bash

# FortenLog Interactive Setup Script

echo "--------------------------------------------------"
echo "   FortenLog Infrastructure Setup Engine v1.0"
echo "--------------------------------------------------"

# Default Values
DEFAULT_PORT=3000
DEFAULT_DOMAIN="localhost"
DEFAULT_ADMIN="admin"
DEFAULT_PASS="fortenlog2026"

# Prompt for Configuration
read -p "Enter Deployment Port [$DEFAULT_PORT]: " PORT
PORT=${PORT:-$DEFAULT_PORT}

read -p "Enter Domain/Hostname [$DEFAULT_DOMAIN]: " DOMAIN
DOMAIN=${DOMAIN:-$DEFAULT_DOMAIN}

read -p "Enter Initial Admin Username [$DEFAULT_ADMIN]: " ADMIN
ADMIN=${ADMIN:-$DEFAULT_ADMIN}

read -p "Enter Initial Admin Password [$DEFAULT_PASS]: " PASS
PASS=${PASS:-$DEFAULT_PASS}

# Create .env file
cat <<EOF > .env
PORT=$PORT
DOMAIN=$DOMAIN
FORTENLOG_ADMIN_USER=$ADMIN
FORTENLOG_ADMIN_PASS=$PASS
RUST_LOG=info
EOF

echo "--------------------------------------------------"
echo "Configuration saved to .env"
echo "Deploying via Docker Compose..."
echo "--------------------------------------------------"

docker-compose up -d --build

echo ""
echo "Deployment Successful!"
echo "Access Platform at: http://$DOMAIN:$PORT"
echo "Initial Credentials: $ADMIN / $PASS"
echo "--------------------------------------------------"
