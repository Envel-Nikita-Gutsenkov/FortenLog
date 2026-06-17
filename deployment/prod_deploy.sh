#!/bin/bash

# ANSI Color Codes for Premium UI
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0;37m' # Normal Text

echo -e "${CYAN}===================================================================${NC}"
echo -e "${MAGENTA}       🚀 FORTENLOG ENTERPRISE PRODUCTION DEPLOYER & WIZARD 🚀     ${NC}"
echo -e "${CYAN}===================================================================${NC}"
echo -e "This interactive installer will configure your secure production VPS."
echo -e "Fully compatible with ${GREEN}Ubuntu / Debian / CentOS / RedHat / Rocky Linux${NC}."
echo ""

# 1. Detect Host OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID=$ID
    OS_NAME=$NAME
else
    OS_ID=$(uname -s)
    OS_NAME=$(uname -s)
fi

echo -e "Host System Detected: ${BLUE}${OS_NAME}${NC} (ID: ${OS_ID})"

# 2. Check for Docker & Docker Compose
DOCKER_FOUND=true
DOCKER_COMPOSE_FOUND=true

if ! command -v docker &> /dev/null; then
    DOCKER_FOUND=false
fi
if ! docker compose version &> /dev/null; then
    DOCKER_COMPOSE_FOUND=false
fi

if [ "$DOCKER_FOUND" = false ] || [ "$DOCKER_COMPOSE_FOUND" = false ]; then
    echo -e "${YELLOW}[WARNING] Docker and/or Docker Compose plugin was not found on this VPS!${NC}"
    read -p "Would you like this script to install Docker & Compose automatically? (y/n): " INSTALL_DOCKER
    if [[ $INSTALL_DOCKER =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}[INFO] Installing Docker Engine & Docker Compose plugin...${NC}"
        
        if [ "$OS_ID" = "ubuntu" ] || [ "$OS_ID" = "debian" ]; then
            sudo apt-get update -y
            sudo apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release
            sudo mkdir -p /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/$OS_ID/gpg | sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS_ID $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
            sudo apt-get update -y
            sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
            sudo systemctl enable --now docker
        elif [ "$OS_ID" = "centos" ] || [ "$OS_ID" = "rocky" ] || [ "$OS_ID" = "rhel" ]; then
            sudo dnf install -y yum-utils
            sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
            sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
            sudo systemctl enable --now docker
        else
            echo -e "${RED}[ERROR] Automated installation is not supported on $OS_NAME.${NC}"
            echo -e "Please install docker and docker compose plugin manually, then rerun this script."
            exit 1
        fi
        echo -e "${GREEN}[SUCCESS] Docker and Compose installed successfully!${NC}"
    else
        echo -e "${RED}[ERROR] Installation aborted. Docker is required to deploy FortenLog.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}[OK] Docker and Docker Compose plugin are active.${NC}"
fi

# 3. Ask deployment questions
echo ""
echo -e "${CYAN}--- Configuration parameters ---${NC}"

# Subdomain Selection
read -p "Enter your target subdomain (e.g. log.mycompany.com): " DOMAIN
if [ -z "$DOMAIN" ]; then
    DOMAIN="localhost"
    echo -e "Defaulting Domain to: ${YELLOW}localhost${NC}"
fi

# Admin configuration
read -p "Enter production admin username (default: admin): " ADMIN_USER
if [ -z "$ADMIN_USER" ]; then
    ADMIN_USER="admin"
fi

# Generates a random secure password for maximum production hygiene
SUGGESTED_PASS=$(openssl rand -base64 12)
read -p "Enter production admin password (default: $SUGGESTED_PASS): " ADMIN_PASS
if [ -z "$ADMIN_PASS" ]; then
    ADMIN_PASS=$SUGGESTED_PASS
fi

# Helper functions to check ports
is_port_in_use() {
    local port=$1
    if command -v ss &> /dev/null; then
        ss -tln | grep -q -E "[:.]$port\s"
    elif command -v netstat &> /dev/null; then
        netstat -tuln | grep -q -E "[:.]$port\s"
    else
        return 1
    fi
}

find_free_port() {
    local port=$1
    while is_port_in_use $port; do
        port=$((port + 1))
    done
    echo $port
}

# Detect port conflicts & Nginx
PORT_80_IN_USE=false
PORT_443_IN_USE=false
HOST_NGINX_RUNNING=false

if is_port_in_use 80; then PORT_80_IN_USE=true; fi
if is_port_in_use 443; then PORT_443_IN_USE=true; fi

if systemctl is-active --quiet nginx &> /dev/null || [ "$PORT_80_IN_USE" = true ]; then
    HOST_NGINX_RUNNING=true
fi

DEPLOY_MODE="standalone"
HTTP_PORT=80
HTTPS_PORT=443
APP_PORT=3000
APP_BIND_IP="127.0.0.1"

if [ "$HOST_NGINX_RUNNING" = true ]; then
    echo -e "\n${YELLOW}[WARNING] A web server (like Nginx) appears to be running on the host (ports 80/443 in use).${NC}"
    echo -e "To avoid port conflicts and keep existing sites running, you should integrate with the host's Nginx."
    echo ""
    echo -e "Choose deployment mode:"
    echo -e "  1) Host Nginx Integration (Recommended - runs app in Docker, routes traffic via host Nginx)"
    echo -e "  2) Standalone Docker (Runs Nginx/Certbot inside Docker on custom ports, e.g., 25080/25443)"
    read -p "Select choice (1-2, default 1): " MODE_CHOICE
    if [ -z "$MODE_CHOICE" ] || [ "$MODE_CHOICE" = "1" ]; then
        DEPLOY_MODE="host-nginx"
    else
        DEPLOY_MODE="standalone"
    fi
fi

if [ "$DEPLOY_MODE" = "host-nginx" ]; then
    echo -e "\n${BLUE}[INFO] Host Nginx Integration Mode Selected.${NC}"
    
    EXISTING_APP_PORT=""
    if [ -f .env ]; then
        EXISTING_APP_PORT=$(grep -E "^APP_PORT=" .env | cut -d'=' -f2)
    fi

    if [ -n "$EXISTING_APP_PORT" ]; then
        SUGGESTED_APP_PORT=$EXISTING_APP_PORT
        echo -e "${BLUE}[INFO] Reusing existing port from .env: ${GREEN}$SUGGESTED_APP_PORT${NC}"
    else
        SUGGESTED_APP_PORT=$(find_free_port 3000)
        if [ "$SUGGESTED_APP_PORT" != "3000" ]; then
            echo -e "${YELLOW}[NOTE] Default port 3000 is already in use by another process.${NC}"
        fi
    fi

    read -p "Enter local port to bind the app to (default $SUGGESTED_APP_PORT): " APP_PORT
    if [ -z "$APP_PORT" ]; then APP_PORT=$SUGGESTED_APP_PORT; fi
    
    # Generate .env configuration
    cat <<EOF > .env
DOMAIN=$DOMAIN
ADMIN_USER=$ADMIN_USER
ADMIN_PASS=$ADMIN_PASS
DEPLOY_MODE=$DEPLOY_MODE
APP_BIND_IP=$APP_BIND_IP
APP_PORT=$APP_PORT
HTTP_PORT=25080
HTTPS_PORT=25443
EOF
    chmod 600 .env
    echo -e "${GREEN}[OK] Written local credential secrets to .env${NC}"

    # Generate host Nginx configuration
    echo -e "${BLUE}[INFO] Generating host Nginx configuration...${NC}"
    
    read -p "Do you want to configure SSL (HTTPS, port 443) for host Nginx? (y/n, default y): " CONFIGURE_SSL
    if [ -z "$CONFIGURE_SSL" ]; then CONFIGURE_SSL="y"; fi
    
    if [[ $CONFIGURE_SSL =~ ^[Yy]$ ]]; then
        read -p "Enter path to SSL certificate (default: /etc/letsencrypt/live/$DOMAIN/fullchain.pem): " HOST_SSL_CERT
        if [ -z "$HOST_SSL_CERT" ]; then HOST_SSL_CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"; fi
        
        read -p "Enter path to SSL certificate key (default: /etc/letsencrypt/live/$DOMAIN/privkey.pem): " HOST_SSL_KEY
        if [ -z "$HOST_SSL_KEY" ]; then HOST_SSL_KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"; fi
        
        cat <<EOF > fortenlog.host.nginx.conf
# FortenLog Host Nginx Configuration Template (HTTPS)
server {
    listen 80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect all HTTP requests to HTTPS
    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate $HOST_SSL_CERT;
    ssl_certificate_key $HOST_SSL_KEY;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 50M;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 10M;
    }

    location /capture/ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 10M;
    }
}
EOF
    else
        cat <<EOF > fortenlog.host.nginx.conf
# FortenLog Host Nginx Configuration Template (HTTP only)
server {
    listen 80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 50M;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 10M;
    }

    location /capture/ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 10M;
    }
}
EOF
    fi
    echo -e "${GREEN}[OK] Created configuration at: $(pwd)/fortenlog.host.nginx.conf${NC}"

    # Offer to automatically apply Host Nginx configuration
    if [ -d /etc/nginx/sites-available ]; then
        read -p "Would you like to install the host Nginx config automatically? (Requires sudo) (y/n): " INSTALL_NGINX
        if [[ $INSTALL_NGINX =~ ^[Yy]$ ]]; then
            echo -e "${BLUE}[INFO] Copying Nginx configuration and reloading...${NC}"
            sudo cp fortenlog.host.nginx.conf /etc/nginx/sites-available/$DOMAIN
            echo -e "${GREEN}[OK] Copied configuration to /etc/nginx/sites-available/$DOMAIN${NC}"
            
            # Ensure sites-enabled directory exists
            sudo mkdir -p /etc/nginx/sites-enabled
            sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
            echo -e "${GREEN}[OK] Created symlink at /etc/nginx/sites-enabled/$DOMAIN${NC}"
            
            if sudo nginx -t; then
                sudo systemctl reload nginx
                echo -e "${GREEN}[SUCCESS] Host Nginx configuration installed and reloaded!${NC}"
                
                # Check for host certbot (only if not configured manually)
                if [ "$CONFIGURE_SSL" != "y" ] && command -v certbot &> /dev/null; then
                    read -p "Certbot detected. Would you like to run it now to get SSL certificates? (y/n): " RUN_CERTBOT
                    if [[ $RUN_CERTBOT =~ ^[Yy]$ ]]; then
                        sudo certbot --nginx -d $DOMAIN
                    fi
                fi
            else
                echo -e "${RED}[ERROR] Nginx test failed. Restoring/skipping reload. Please check /etc/nginx/sites-available/$DOMAIN${NC}"
            fi
        fi
    elif [ -d /etc/nginx/conf.d ]; then
        read -p "Would you like to install the host Nginx config automatically into /etc/nginx/conf.d? (Requires sudo) (y/n): " INSTALL_NGINX
        if [[ $INSTALL_NGINX =~ ^[Yy]$ ]]; then
            echo -e "${BLUE}[INFO] Copying Nginx configuration and reloading...${NC}"
            sudo cp fortenlog.host.nginx.conf /etc/nginx/conf.d/$DOMAIN.conf
            if sudo nginx -t; then
                sudo systemctl reload nginx
                echo -e "${GREEN}[SUCCESS] Host Nginx configuration installed and reloaded!${NC}"
            else
                echo -e "${RED}[ERROR] Nginx test failed. Restoring/skipping reload. Please check /etc/nginx/conf.d/$DOMAIN.conf${NC}"
            fi
        fi
    else
        echo -e "${YELLOW}[NOTE] Nginx configuration directories (/etc/nginx/sites-available or /etc/nginx/conf.d) not found. Please manually copy 'fortenlog.host.nginx.conf' to your Nginx configuration directory.${NC}"
    fi

else
    # Standalone mode
    # Ask SSL Mode
    echo ""
    echo -e "Select SSL Mode:"
    echo -e "  1) Let's Encrypt (Automated, free production certificates. Requires port 80/443 open to internet)"
    echo -e "  2) Self-Signed (Generate immediate local certificates for sandboxed/local test environments)"
    echo -e "  3) HTTP Only (Disabled SSL, running behind a pre-existing upstream load balancer/proxy)"
    read -p "Select choice (1-3, default 1): " SSL_MODE
    if [ -z "$SSL_MODE" ]; then SSL_MODE="1"; fi

    if [ "$PORT_80_IN_USE" = true ] || [ "$PORT_443_IN_USE" = true ]; then
        echo -e "\n${YELLOW}[WARNING] Port 80 or 443 is already in use on this server!${NC}"
        read -p "Enter custom host HTTP port to bind (default 25080): " HTTP_PORT
        if [ -z "$HTTP_PORT" ]; then HTTP_PORT=25080; fi
        read -p "Enter custom host HTTPS port to bind (default 25443): " HTTPS_PORT
        if [ -z "$HTTPS_PORT" ]; then HTTPS_PORT=25443; fi
    else
        echo ""
        read -p "Enter host HTTP port to bind (default 80): " HTTP_PORT
        if [ -z "$HTTP_PORT" ]; then HTTP_PORT=80; fi
        read -p "Enter host HTTPS port to bind (default 443): " HTTPS_PORT
        if [ -z "$HTTPS_PORT" ]; then HTTPS_PORT=443; fi
    fi

    # Write .env configuration
    cat <<EOF > .env
DOMAIN=$DOMAIN
ADMIN_USER=$ADMIN_USER
ADMIN_PASS=$ADMIN_PASS
DEPLOY_MODE=$DEPLOY_MODE
APP_BIND_IP=127.0.0.1
APP_PORT=3000
HTTP_PORT=$HTTP_PORT
HTTPS_PORT=$HTTPS_PORT
EOF
    chmod 600 .env
    echo -e "${GREEN}[OK] Written local credential secrets to .env${NC}"

    # Resolve Nginx Template config
    echo -e "${BLUE}[INFO] Resolving Nginx proxy templates...${NC}"
    cp nginx.conf.template nginx.conf
    sed -i "s/\${DOMAIN}/$DOMAIN/g" nginx.conf

    # SSL validation mode setup
    sudo mkdir -p /etc/letsencrypt/live/$DOMAIN

    if [ "$SSL_MODE" = "1" ]; then
        echo -e "${BLUE}[INFO] Fetching Let's Encrypt SSL certificates...${NC}"
        read -p "Enter alert email for Let's Encrypt (required): " SSL_EMAIL
        if [ -z "$SSL_EMAIL" ]; then
            echo -e "${RED}[ERROR] Email is required for Let's Encrypt validation.${NC}"
            exit 1
        fi
        
        # Create webroot paths
        mkdir -p certbot_webroot
        
        # Spin up temp Nginx container to pass Let's Encrypt ACME HTTP challenge
        echo -e "Starting temporary Nginx webserver to perform ACME challenge..."
        docker run -d --name temp_nginx -p 80:80 -v $(pwd)/certbot_webroot:/usr/share/nginx/html nginx:alpine
        
        # Run certbot standalone
        docker run --rm --name certbot \
          -v /etc/letsencrypt:/etc/letsencrypt \
          -v $(pwd)/certbot_webroot:/var/www/certbot \
          certbot/certbot certonly --webroot -w /var/www/certbot \
          -d $DOMAIN --email $SSL_EMAIL --agree-tos --no-eff-email --non-interactive
          
        docker stop temp_nginx
        docker rm temp_nginx
        rm -rf certbot_webroot
        
        if [ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
            echo -e "${RED}[ERROR] Let's Encrypt verification failed!${NC}"
            echo -e "Ensure your domain DNS points to this server's public IP and ports 80/443 are open."
            read -p "Would you like to fallback to a Self-Signed certificate for testing? (y/n): " FALLBACK
            if [[ $FALLBACK =~ ^[Yy]$ ]]; then
                SSL_MODE="2"
            else
                exit 1
            fi
        else
            echo -e "${GREEN}[SUCCESS] Let's Encrypt SSL active!${NC}"
        fi
    fi

    if [ "$SSL_MODE" = "2" ]; then
        echo -e "${BLUE}[INFO] Issuing secure Self-Signed TLS certificates (Local OpenSSL)...${NC}"
        sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
          -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
          -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
          -subj "/CN=$DOMAIN/O=FortenLog/C=US"
        echo -e "${GREEN}[SUCCESS] Self-Signed SSL keys written!${NC}"
    fi

    if [ "$SSL_MODE" = "3" ]; then
        echo -e "${YELLOW}[INFO] HTTP Only Mode Selected. Tweaking Nginx Proxy configuration...${NC}"
        # Disables redirection to HTTPS
        cat <<EOF > nginx.conf
user nginx;
worker_processes auto;
events { worker_connections 1024; }
http {
    include /etc/nginx/mime.types;
    server {
        listen 80;
        server_name $DOMAIN;
        location / {
            proxy_pass http://fortenlog:3000;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
        }
    }
}
EOF
    fi
fi

# 6. Deploy containers
echo -e "\n${BLUE}[INFO] Building and starting production environment containers...${NC}"

# Ask if they want to clear all data
echo -e "${YELLOW}Do you want to wipe all existing data and start fresh? [y/N] (Default: Keep)${NC}"
read -p "Wipe all data? (y/N): " CLEAR_DATA

# Explicitly stop/remove conflicting containers if they exist (even if managed by other/orphan compose configs)
if docker ps -a --format '{{.Names}}' | grep -Eq "^fortenlog_app$"; then
    echo -e "${BLUE}[INFO] Stopping and removing old fortenlog_app container to avoid network conflicts...${NC}"
    docker stop fortenlog_app &> /dev/null
    docker rm fortenlog_app &> /dev/null
fi

if [[ $CLEAR_DATA =~ ^[Yy]$ ]]; then
    echo -e "${RED}[WARNING] Wiping all data (removing docker volumes)...${NC}"
    docker compose -f docker-compose.prod.yml down -v --remove-orphans &> /dev/null
else
    docker compose -f docker-compose.prod.yml down --remove-orphans &> /dev/null
fi

if [ "$DEPLOY_MODE" = "host-nginx" ]; then
    docker compose -f docker-compose.prod.yml up -d --build --pull always fortenlog
else
    docker compose -f docker-compose.prod.yml up -d --build --pull always
fi

# 7. Print premium confirmation panel
echo ""
echo -e "${GREEN}===================================================================${NC}"
echo -e "🎉      FORTENLOG SECURE PRODUCTION DEPLOYMENT COMPLETED!     🎉"
echo -e "${GREEN}===================================================================${NC}"
echo -e " Your log analytics workspace is now active, isolated, and secure!"
echo ""
if [ "$HTTPS_PORT" = "443" ]; then
    echo -e " 🖥️  URL:             ${CYAN}https://$DOMAIN${NC}"
else
    echo -e " 🖥️  URL:             ${CYAN}https://$DOMAIN:$HTTPS_PORT${NC}"
fi
echo -e " 🔑  Admin Username:  ${GREEN}$ADMIN_USER${NC}"
echo -e " 🔑  Admin Password:  ${YELLOW}$ADMIN_PASS${NC}"
echo ""
echo -e " Keep your credentials safe. To upgrade or update the container without downtime,"
echo -e " execute: ${BLUE}./prod_update.sh${NC} inside this directory."
echo -e "${GREEN}===================================================================${NC}"
