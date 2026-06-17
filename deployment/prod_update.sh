#!/bin/bash

# ANSI Color Codes for Premium UI
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0;37m'

echo -e "${CYAN}===================================================================${NC}"
echo -e "       ♻️  FORTENLOG PRODUCTION VPS CONTAINER UPGRADE UTILITY ♻️     "
echo -e "${CYAN}===================================================================${NC}"
echo ""

# Navigate up to the repository root to pull the latest git status
cd ..

echo -e "${BLUE}[1/4] Pulling latest production codes from Git...${NC}"
git pull origin main

echo -e "\n${BLUE}[2/4] Redeploying production docker compose environment...${NC}"
cd deployment
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

echo -e "${YELLOW}Do you want to wipe all existing data and start fresh? [y/N] (Default: Keep)${NC}"
read -p "Wipe all data? (y/N): " CLEAR_DATA

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

echo -e "\n${BLUE}[3/4] Reclaiming disk space (cleaning dangling docker assets)...${NC}"
docker image prune -f

echo -e "\n${GREEN}[4/4] FortenLog upgraded successfully!${NC}"
echo -e "Your tracking server is running at maximum efficiency."
echo -e "${CYAN}===================================================================${NC}"
