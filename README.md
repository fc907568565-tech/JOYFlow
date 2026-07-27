# JOYFlow

互动视觉资产生产工作台，包含 AI 图片/视频生成、图鉴工作流、JOY 角色编排、素材仓库和 Lottie 转换工具。

## 在线版本

GitHub Pages 部署地址：

`https://fc907568565-tech.github.io/JOYFlow/`

## 模型配置

- 内置预设保留模型名称、Base URL、接口路径和生成参数。
- API Key 不包含在源码或 GitHub 仓库中。
- 使用者需要在“接口配置”中填写自己的 API Key。
- 自定义预设保存在当前浏览器中，但保存时会自动移除 API Key。

## GitHub Pages 实验范围

GitHub Pages 是静态托管，界面、编辑器、本地素材库和非敏感模型配置可以正常加载。

项目目前使用的 `/joy-compose`、`/joy-proxy`、`/ark-api`、`/google-api` 和 `/jd-api`
依赖服务端代理。它们不会在纯 GitHub Pages 环境中运行。要让 JOY 角色画布和需要代理的模型
在公开环境可用，需要把这些路由部署到同域的 Cloudflare Pages Functions、Vercel Functions
或其他后端服务。

## 本地开发

```bash
npm ci
npm run dev
```

## 验证

```bash
npm run lint
npm run build
```
