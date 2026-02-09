# 德州扑克部署教程

## 项目信息

- 仓库地址: `https://github.com/e18617147314-netizen/ERPAN.git`
- 分支: `claude/multiplayer-poker-game-61PZh`
- 技术栈: Node.js + WebSocket (`ws` 库)
- 端口: 默认 3000，可通过环境变量 `PORT` 修改

## 部署步骤

### 1. 克隆代码

```bash
git clone https://github.com/e18617147314-netizen/ERPAN.git
cd ERPAN
git checkout claude/multiplayer-poker-game-61PZh
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动服务

**直接运行:**

```bash
node server.js
```

**指定端口:**

```bash
PORT=8080 node server.js
```

**后台运行 (推荐):**

```bash
nohup node server.js > poker.log 2>&1 &
```

### 4. 用 systemd 管理 (生产环境推荐)

创建服务文件:

```bash
cat > /etc/systemd/system/poker.service << 'EOF'
[Unit]
Description=Texas Holdem Poker Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/ERPAN
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=PORT=3000
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
```

启用并启动:

```bash
systemctl daemon-reload
systemctl enable poker
systemctl start poker
```

查看状态:

```bash
systemctl status poker
journalctl -u poker -f
```

### 5. Nginx 反向代理 (可选，用于域名/HTTPS)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

```bash
# 测试并重载 nginx
nginx -t && systemctl reload nginx
```

如果需要 HTTPS，用 certbot:

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d your-domain.com
```

### 6. Docker 部署 (可选)

```bash
docker build -t poker .
docker run -d --name poker -p 3000:3000 --restart always poker
```

## 验证部署

服务启动后访问 `http://你的服务器IP:3000`，能看到德州扑克页面即部署成功。

## 防火墙

确保对应端口已开放:

```bash
# ufw
ufw allow 3000/tcp

# 或 firewalld
firewall-cmd --permanent --add-port=3000/tcp
firewall-cmd --reload
```

## 一键部署脚本

可以将以下内容保存为 `deploy.sh` 在服务器上直接执行:

```bash
#!/bin/bash
set -e

# 克隆并切换分支
git clone https://github.com/e18617147314-netizen/ERPAN.git /opt/poker
cd /opt/poker
git checkout claude/multiplayer-poker-game-61PZh

# 安装依赖
npm install --production

# 创建 systemd 服务
cat > /etc/systemd/system/poker.service << 'UNIT'
[Unit]
Description=Texas Holdem Poker Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/poker
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
UNIT

# 启动
systemctl daemon-reload
systemctl enable poker
systemctl start poker

echo "部署完成，访问 http://$(hostname -I | awk '{print $1}'):3000"
```
