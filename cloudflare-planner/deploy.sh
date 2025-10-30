#!/bin/bash

# Cloudflare React Planner - Deployment Script
set -e

echo "🚀 Cloudflare React Planner Deployment Script"
echo "=============================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID:-""}
CONTAINER_NAME="react-planner-container"
WORKER_NAME="react-planner-agent-gateway"

# Check prerequisites
check_prerequisites() {
    echo -e "\n${YELLOW}Checking prerequisites...${NC}"

    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: Docker is not installed${NC}"
        exit 1
    fi

    if ! command -v wrangler &> /dev/null; then
        echo -e "${RED}Error: Wrangler CLI is not installed${NC}"
        echo "Install with: npm install -g wrangler"
        exit 1
    fi

    if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
        echo -e "${YELLOW}CLOUDFLARE_ACCOUNT_ID not set. Attempting to get from wrangler...${NC}"
        CLOUDFLARE_ACCOUNT_ID=$(wrangler whoami | grep "Account ID" | awk '{print $3}')
        if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
            echo -e "${RED}Error: Could not determine Cloudflare Account ID${NC}"
            echo "Please run: export CLOUDFLARE_ACCOUNT_ID=your-account-id"
            exit 1
        fi
    fi

    echo -e "${GREEN}✓ All prerequisites met${NC}"
    echo "Account ID: $CLOUDFLARE_ACCOUNT_ID"
}

# Build react-planner demo
build_planner() {
    echo -e "\n${YELLOW}Building react-planner demo...${NC}"

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
cd "$SCRIPT_DIR/.."
    if [ ! -f "package.json" ]; then
        echo -e "${RED}Error: Not in react-planner directory${NC}"
        exit 1
    fi

    npm install
    npm run build-demo

    echo -e "${GREEN}✓ React planner built${NC}"
    cd cloudflare-planner
}

# Build and push container
deploy_container() {
    echo -e "\n${YELLOW}Building and deploying container...${NC}"

    # Copy demo files
    mkdir -p container/demo/dist
    cp -r ../demo/dist/* container/demo/dist/

    # Build container
    cd container
    docker build -t $CONTAINER_NAME:latest .

    # Tag for Cloudflare
    REGISTRY_URL="registry.cloudflare.com/$CLOUDFLARE_ACCOUNT_ID/$CONTAINER_NAME:latest"
    docker tag $CONTAINER_NAME:latest $REGISTRY_URL

    echo -e "${YELLOW}Pushing to Cloudflare Container Registry...${NC}"
    CLOUDFLARE_EMAIL=$(wrangler whoami | grep "email" | sed 's/.*email //;s/\.//')
    echo "$CLOUDFLARE_API_TOKEN" | docker login registry.cloudflare.com --username "$CLOUDFLARE_EMAIL" --password-stdin
    docker push $REGISTRY_URL

    echo -e "${GREEN}✓ Container deployed${NC}"
    echo "Registry URL: $REGISTRY_URL"

    cd ..
}

# Setup Cloudflare resources
setup_resources() {
    echo -e "\n${YELLOW}Setting up Cloudflare resources...${NC}"

    cd worker

    # Create KV namespace if it doesn't exist
    echo "Creating KV namespace..."
    KV_ID=$(wrangler kv:namespace list | grep "PLANNER_METADATA" | awk '{print $2}' || echo "")
    if [ -z "$KV_ID" ]; then
        wrangler kv:namespace create "PLANNER_METADATA"
        echo -e "${YELLOW}⚠ Please update wrangler.toml with the KV namespace ID${NC}"
    else
        echo -e "${GREEN}✓ KV namespace exists${NC}"
    fi

    # Create R2 bucket if it doesn't exist
    echo "Creating R2 bucket..."
    if ! wrangler r2 bucket list | grep -q "react-planner-storage"; then
        wrangler r2 bucket create react-planner-storage
        echo -e "${GREEN}✓ R2 bucket created${NC}"
    else
        echo -e "${GREEN}✓ R2 bucket exists${NC}"
    fi

    # Create Queue if it doesn't exist
    echo "Creating Queue..."
    if ! wrangler queues list | grep -q "planner-tasks-queue"; then
        wrangler queues create planner-tasks-queue
        echo -e "${GREEN}✓ Queue created${NC}"
    else
        echo -e "${GREEN}✓ Queue exists${NC}"
    fi

    cd ..
}

# Deploy worker
deploy_worker() {
    echo -e "\n${YELLOW}Deploying worker...${NC}"

    cd worker

    # Install dependencies
    npm install

    # Deploy
    wrangler deploy

    echo -e "${GREEN}✓ Worker deployed${NC}"

    # Get worker URL
    WORKER_URL=$(wrangler deployments list | grep "https://" | head -1 | awk '{print $1}')
    if [ -n "$WORKER_URL" ]; then
        echo -e "${GREEN}Worker URL: $WORKER_URL${NC}"
    fi

    cd ..
}

# Main deployment flow
main() {
    echo -e "\nDeployment Steps:"
    echo "1. Check prerequisites"
    echo "2. Build react-planner demo"
    echo "3. Build and deploy container"
    echo "4. Setup Cloudflare resources"
    echo "5. Deploy worker"
    echo ""
    read -p "Continue with deployment? (y/n) " -n 1 -r
    echo

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Deployment cancelled"
        exit 1
    fi

    check_prerequisites
    build_planner
    deploy_container
    setup_resources
    deploy_worker

    echo -e "\n${GREEN}========================================${NC}"
    echo -e "${GREEN}🎉 Deployment Complete!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Update wrangler.toml with your container ID"
    echo "2. Test the deployment:"
    echo "   curl https://$WORKER_NAME.YOUR_SUBDOMAIN.workers.dev/health"
    echo ""
    echo "3. Try a command:"
    echo "   curl -X POST https://$WORKER_NAME.YOUR_SUBDOMAIN.workers.dev/modify \\"
    echo "     -H 'Content-Type: application/json' \\"
    echo "     -d '{\"sessionId\":\"test\",\"prompt\":\"Add a sofa\"}'"
}

# Run main function
main
