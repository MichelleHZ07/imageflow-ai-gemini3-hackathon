#!/bin/bash
# deploy-backend.sh
# ImageFlow AI 后端部署脚本

set -e  # 遇到错误立即退出

# ============================================
# 配置（根据你的项目修改）
# ============================================
PROJECT_ID="imageflow-dev"
REGION="us-central1"
SERVICE_NAME="imageflow-backend"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# ============================================
# 颜色输出
# ============================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  ImageFlow AI Backend Deployment${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# ============================================
# 1. 检查 gcloud 配置
# ============================================
echo -e "${YELLOW}[1/4] Checking gcloud configuration...${NC}"
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null)
if [ "$CURRENT_PROJECT" != "$PROJECT_ID" ]; then
    echo "Setting project to $PROJECT_ID"
    gcloud config set project $PROJECT_ID
fi
echo -e "${GREEN}✓ Project: $PROJECT_ID${NC}"
echo ""

# ============================================
# 2. 构建 Docker 镜像
# ============================================
echo -e "${YELLOW}[2/4] Building and pushing Docker image...${NC}"
echo "This may take a few minutes..."
gcloud builds submit --tag $IMAGE_NAME .
echo -e "${GREEN}✓ Image built: $IMAGE_NAME${NC}"
echo ""

# ============================================
# 3. 部署到 Cloud Run
# ============================================
echo -e "${YELLOW}[3/4] Deploying to Cloud Run...${NC}"
gcloud run deploy $SERVICE_NAME \
  --image $IMAGE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --timeout 300 \
  --set-env-vars "NODE_ENV=production"

echo -e "${GREEN}✓ Deployed to Cloud Run${NC}"
echo ""

# ============================================
# 4. 获取服务 URL
# ============================================
echo -e "${YELLOW}[4/4] Getting service URL...${NC}"
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format 'value(status.url)')
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Service URL: ${GREEN}$SERVICE_URL${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Set environment variables in Cloud Run Console or using:"
echo "   gcloud run services update $SERVICE_NAME --region $REGION --set-env-vars \"KEY=VALUE\""
echo ""
echo "2. Update frontend .env.production with:"
echo "   VITE_API_BASE=$SERVICE_URL"
echo ""
echo "3. Test the health endpoint:"
echo "   curl $SERVICE_URL/health"
echo ""