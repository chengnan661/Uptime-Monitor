# Cloudflare Worker Uptime Monitor 实现计划表

这个项目将构建一个基于 Cloudflare Workers (Cron Triggers) + D1 (Database) 的高可用、低成本监控系统。

## 1. 项目初始化与架构

* **技术栈**: Cloudflare Workers (TypeScript), D1 Database, Hono (轻量级 Web 框架，用于 API), Zod (配置验证).

* **目录结构**:

  * `src/`: 后端源代码

  * `frontend/`: 前端源代码 (React/Vue/Static HTML)

  * `wrangler.toml`: Cloudflare 配置文件

  * `config.yaml`: 用户定义的监控配置

## 2. 核心功能模块设计

### 2.1 声明式配置 (Configuration)

设计 `config.yaml` 或 `config.json` 结构，包含：

* **监控组 (Groups)**: 分组管理。

* **监控项 (Monitors)**:

  * **基础信息**: ID, Name, URL, Type (HTTP/TCP), Tags.

  * **请求配置**: Method, Headers, Body, Timeout.

  * **验证逻辑**: 预期状态码, 响应体/头匹配规则 (正则/包含).

  * **阈值设置**:

    * `expected_latency`: 良好响应时间 (超过即视为性能降级).

    * `timeout`: 超时时间.

    * `grace_period`: 宽限次数 (连续失败多少次才报警/显示离线).

  * **展示设置**: 是否展示图表, 是否展示历史, 是否允许点击跳转.

  * **通知回调**: Webhook URL (支持状态变更时触发).

### 2.2 数据库设计 (D1 Schema)

* `monitors_state`: 存储每个监控项的当前状态 (Status, Last Check, Fail Count 等).

* `checks_history`: 存储历史检查数据 (用于绘制延迟折线图).

  * 字段: `monitor_id`, `timestamp`, `latency`, `status`, `message`.

* `incidents`: 记录宕机/恢复事件历史.

### 2.3 监控引擎 (Worker Cron)

* **调度**: 配置 Cron Trigger (如每分钟执行).

* **并发执行**: 并行处理所有监控项检查.

* **检查逻辑**:

  * **HTTP**: 使用 `fetch` API, 支持自定义 Method/Headers/Body. 检查响应时间与内容.

  * **TCP**: 使用 `cloudflare:sockets` 进行连接测试 (注意: 标准 Workers 需确认 TCP Socket 权限，通常需 Standard 计划或特定配置，如果受限则回退到仅 HTTP 或使用 WebSocket).

* **状态判定**:

  * **Normal**: 响应时间 < 良好时间.

  * **Degraded**: 良好时间 < 响应时间 < 超时.

  * **Down**: 超时 或 验证失败 (需满足宽限期逻辑).

* **报警触发**: 当状态发生实质变化 (考虑宽限期) 时，发送 Webhook.

### 2.4 API 服务 (Worker Fetch)

* `GET /api/config`: 返回处理过的（脱敏）配置信息（组结构、展示设置）.

* `GET /api/status`: 返回当前所有监控项的状态.

* `GET /api/history/:id`: 获取指定监控项的历史延迟数据 (用于图表).

### 2.5 前端展示 (Frontend)

* 纯静态页面 (SPA).

* 部署时仅需配置 API 地址 (即 Worker 的 URL).

* 功能:

  * 展示监控组及子项.

  * 状态指示灯 (绿/黄/红).

  * 延迟折线图 (可选).

  * 详情与跳转 (根据配置).

## 3. 实施步骤

### 第一阶段: 基础架构搭建

1. 初始化 `wrangler` 项目.
2. 创建 D1 数据库并编写 SQL Schema.
3. 定义 TypeScript 类型接口与配置解析器.

### 第二阶段: 监控核心逻辑

1. 编写 HTTP 检查器 (Fetch wrapper).
2. 编写 TCP 检查器 (Socket connect).
3. 实现 Cron Handler: 加载配置 -> 执行检查 -> 写入 D1.

### 第三阶段: 状态管理与回调

1. 实现宽限期逻辑 (读取上次状态对比).
2. 实现 Webhook 回调通知.
3. 完善 D1 数据写入与清理策略 (避免历史数据无限膨胀).

### 第四阶段: API 与 前端

1. 实现 REST API 接口.
2. 编写一个简单的前端页面用于展示.
3. 编写部署文档.

请审查以上计划，如果没有问题，我将开始从第一阶段着手开发。
