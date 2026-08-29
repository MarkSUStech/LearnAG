---
goal: 部署 HTTPS 罗站
standard: 能在阿里云 ECS 上独立部署一个 HTTPS 网站，理解从 DNS 解析到 TLS 加密的完整链路
current_path: 待用户选择
current_stage: 0
---

# 目标：在阿里云部署 HTTPS 网站

## 你的现状

- ✅ 阿里云账号（有 ECS）
- ✅ Python 基础（mastery 8）
- ✅ HTTP 基础（mastery 6）
- ❌ Linux 命令行：零基础
- ❌ DNS：零基础
- ❌ HTTPS/TLS 原理：零基础

## 目标拆解

```
部署 HTTPS 网站
├── Linux 命令行操作（文件、权限、服务管理）
├── DNS 解析配置（A 记录、CNAME）
├── 阿里云 ECS 购买与安全组配置
├── Nginx 安装与配置
├── SSL 证书获取（Let's Encrypt）
└── TLS/HTTPS 原理理解
```

---

# 三条学习路径

## 选项 1：最短路径（6 周， fastest to working site）

> 目标：最快拿到一个能跑的 HTTPS 网站，先跑通再深挖原理。

| 阶段 | 内容 | 产出 |
|------|------|------|
| W1 | Linux 基础命令 + SSH 连接 ECS | 能熟练操作服务器 |
| W1 | DNS 解析配置（A 记录） | 域名指向 ECS |
| W2 | 阿里云安全组配置（80/443/22） | 端口放行 |
| W2 | Nginx 安装 + HTTP 站点配置 | 跑起一个 HTTP 网站 |
| W3 | Let's Encrypt 证书申请（certbot） | 拿到免费 SSL 证书 |
| W3 | Nginx HTTPS 配置 + 301 重定向 | HTTPS 网站上线 |
| W4 | 验收 + 基础原理讲解 | 能解释 HTTPS 工作流程 |

## 选项 2：深度路径（10~12 周，彻底搞懂底层）

> 目标：不仅会配，还要理解每一步背后的原理。适合你"彻底搞懂"的需求。

| 阶段 | 内容 | 深度要求 |
|------|------|----------|
| W1 | Linux 命令行 + 文件系统 + 权限模型 | 理解 inode、硬链接、权限位 |
| W2 | TCP/IP 基础 + HTTP 原理回顾 | 三次握手、请求响应生命周期 |
| W3 | HTTPS/TLS 握手全过程 | RSA/AES/SHA 在握手中的角色 |
| W4 | DNS 递归查询 + 缓存机制 + TTL | 从根域名到权威域名的完整链路 |
| W5 | PKI 公钥基础设施 + 证书链验证 | 根 CA → 中间 CA → 网站证书 |
| W6 | Let's Encrypt + ACME 协议原理 | 为什么 90 天自动续期 |
| W7 | Nginx 配置深入 | 反向代理、负载均衡、缓存策略 |
| W8 | 阿里云 VPC + 安全组 + SLB | 网络隔离与访问控制 |
| W9~W10 | 实战部署 + 安全加固 + 验收 | HTTPS 站点上线 + 性能调优 |

## 选项 3：广度路径（12~14 周，从单机到分布式）

> 目标：不止部署一台，延伸到容器化、自动化、CDN、监控等运维能力。

| 阶段 | 内容 |
|------|------|
| W1~W2 | Linux 基础 + DNS + ECS 配置 |
| W3~W4 | Nginx + Let's Encrypt（HTTPS 上线） |
| W5 | Docker 容器化部署 |
| W6 | CI/CD 自动部署（GitHub Actions → ECS） |
| W7 | 负载均衡（SLB）+ 自动伸缩 |
| W8 | CDN 内容分发 |
| W9 | WAF 防火墙 + 安全加固 |
| W10 | 监控告警 + 日志分析（Prometheus + Grafana） |
| W11~W12 | 多 Region 容灾 + 数据备份 + 验收 |

---

# 推荐

考虑到你明确说**"彻底搞懂底层原理"**，我推荐 **选项 2：深度路径**。它不 skip 任何原理层面，同时 10~12 周也能把网站跑起来——第一周就能 SSH 连上 ECS，第三周就能看到 HTTPS 小锁图标。

---

## 资料来源

- [HTTPS 与 SSL 证书概要 - 菜鸟教程](https://www.runoob.com/w3cnote/https-ssl-intro.html)
- [DNS 域名系统 - 百度百科](https://baike.baidu.com/item/%E5%9F%9F%E5%90%8D%E7%B3%BB%E7%BB%9F/2251573)
- [阿里云 ECS + Nginx 部署指南](资料/部署HTTPS网站/web/03-阿里云ECS与Nginx部署HTTPS.md)
- [Linux 命令行基础](资料/部署HTTPS网站/web/04-Linux命令行基础与文件权限.md)