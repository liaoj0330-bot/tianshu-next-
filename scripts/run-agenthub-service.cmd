@echo off
set "TIANSHU_HOST=0.0.0.0"
set "TIANSHU_ALLOW_REMOTE=1"
set "TIANSHU_PORT=4317"
cd /d D:\AI_Workspace\tianshu-next-
start "TianShu AgentHub" /b "C:\Program Files\nodejs\node.exe" scripts\tianshu-service.mjs
