# 天枢部署边界

天枢当前适合受控试运行。代码公开、局域网体验和公网生产是三件不同的事，不能混为一谈。

## 试运行前提

- 使用 Node.js 22.5 或更高版本。
- 使用独立的 `TIANSHU_RUNTIME_ROOT` 保存 SQLite、备份、产物和锁文件，不把运行目录提交到 Git。
- 默认仅绑定 `127.0.0.1`。只有明确设置 `TIANSHU_ALLOW_REMOTE=1` 时才能绑定局域网或公网地址。
- 通过反向代理或内网访问控制暴露服务，不直接把开发机端口无保护地暴露到公网。

## 最小启动

```powershell
npm ci
npm test
$env:TIANSHU_RUNTIME_ROOT = "D:\\TianShuRuntime"
npm run service
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:4317/health
```

交互入口：`/agenthub`。

## 公网发布门槛

在以下事项完成前，不应将实例描述为公开生产服务：

1. 身份认证与创建者权限初始化。
2. HTTPS、反向代理、网络访问控制与请求限流。
3. SQLite 备份恢复演练与运行日志监控。
4. Agent Provider 凭据通过部署环境注入，绝不写入仓库或 SQLite 业务状态。
5. 用真实但低风险的材料批次连续验证输入、确认、执行、复核和恢复流程。

## 产品承诺

天枢可以协助判断、计划和受控执行，但不会将材料接收自动解释为执行授权。Executor 的报告也不会替代独立复核和创建者最终验收。
