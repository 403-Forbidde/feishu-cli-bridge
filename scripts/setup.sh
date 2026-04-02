#!/usr/bin/env bash
set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

REQUIRED_NODE_VERSION="20.0.0"
REPO_URL="${REPO_URL:-https://github.com/ERROR403/feishu-cli-bridge.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/feishu-cli-bridge}"

echo -e "${GREEN}🚀 Feishu CLI Bridge 一键安装脚本${NC}"
echo ""

# 检查 Node.js
check_node() {
  if command -v node &> /dev/null; then
    local node_version
    node_version=$(node --version | sed 's/v//')
    if [ "$(printf '%s\n' "$REQUIRED_NODE_VERSION" "$node_version" | sort -V | head -n1)" = "$REQUIRED_NODE_VERSION" ]; then
      echo -e "${GREEN}✅ Node.js v${node_version} 已安装${NC}"
      return 0
    else
      echo -e "${YELLOW}⚠️ Node.js v${node_version} 版本过低，需要 >= ${REQUIRED_NODE_VERSION}${NC}"
      return 1
    fi
  else
    echo -e "${YELLOW}⚠️ Node.js 未安装${NC}"
    return 1
  fi
}

# 安装 Node.js
install_node() {
  echo ""
  echo -e "${YELLOW}📦 正在安装 Node.js...${NC}"

  if command -v apt-get &> /dev/null; then
    # Debian/Ubuntu
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v dnf &> /dev/null; then
    # Fedora/RHEL
    sudo dnf module reset nodejs -y
    sudo dnf module install nodejs:20/common -y
  elif command -v yum &> /dev/null; then
    # CentOS
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo yum install -y nodejs
  elif command -v pacman &> /dev/null; then
    # Arch
    sudo pacman -S nodejs npm --noconfirm
  elif command -v brew &> /dev/null; then
    # macOS Homebrew
    brew install node@20
  else
    echo -e "${RED}❌ 未找到支持的包管理器，请手动安装 Node.js >= ${REQUIRED_NODE_VERSION}${NC}"
    exit 1
  fi
}

# 主流程
if ! check_node; then
  install_node
  if ! check_node; then
    echo -e "${RED}❌ Node.js 安装失败，请手动安装后重试${NC}"
    exit 1
  fi
fi

# 检查 git
if ! command -v git &> /dev/null; then
  echo -e "${RED}❌ 请先安装 git${NC}"
  exit 1
fi

# 克隆或更新项目
echo ""
echo -e "${GREEN}📥 下载项目...${NC}"
if [ -d "$INSTALL_DIR" ]; then
  echo -e "${YELLOW}目录已存在，更新代码...${NC}"
  cd "$INSTALL_DIR"
  git pull
else
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# 安装依赖
echo ""
echo -e "${GREEN}📦 安装依赖...${NC}"
npm install

# 运行交互式安装向导
echo ""
echo -e "${GREEN}🧙 启动交互式安装向导...${NC}"
npm run setup:dev

echo ""
echo -e "${GREEN}🎉 安装完成！${NC}"
echo -e "项目目录: ${YELLOW}$INSTALL_DIR${NC}"
echo -e "启动命令: ${YELLOW}cd $INSTALL_DIR \u0026\u0026 npm start${NC}"
