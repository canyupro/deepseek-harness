# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

文档：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

> **本仓库是个人分支。** [`canyupro/deepseek-harness`](https://github.com/canyupro/deepseek-harness) 由个人维护，用于在上游项目之上搭建自己的 harness；它不是 DeepSeek AI 的发行版本，也不用于反馈上游项目的问题。上游是 [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)。本 fork 只在 `dev` 上工作，它是唯一的长期分支：插件、团队配置、技能与本地设置都放在那里，`master` 跟随上游。由于这是个人项目，`dev` 直接使用——没有特性分支、评审或发行流程——需要时再从上游 rebase 或合并跟进。

## 在另一台机器上运行本分支

`dev` 的克隆自带：harness 代码、[`.dsh/local-plugins/`](.dsh/local-plugins/) 下的本地插件 bundle、[`.dsh/team.json`](.dsh/team.json) 里的 Agent Teams 编制，以及 [`.dsh/profile.patch.yml`](.dsh/profile.patch.yml) 里本分支的部署取值。构建产物、凭据、`$DSH_HOME` 下的 profile 目录以及全部会话都留在生成本机，因此新克隆只需三步。

```sh
git clone https://github.com/canyupro/deepseek-harness.git && cd deepseek-harness
git switch dev
pnpm install && pnpm run build
```

把 overlay 里点名的提供方密钥——`MINIMAX_CN_API_KEY`、`COMMANDCODE_API_KEY`、`YJGORK_API_KEY` 与 `DEEPSEEK_API_KEY`——作为启动器的环境变量提供，然后带 overlay 启动：`pnpm dsh desktop --patch .dsh/profile.patch.yml`。启动器 overlay 叠加在 profile 自身的 patch 之上，因此这些模型路由与 inspector 来源无需改动首次启动所生成的 profile 即可生效。若某条启动路径无法透传额外参数，就把 overlay 的行并入 `$DSH_HOME/profiles/desktop/cordis.patch.yml`：两者格式相同，同 id 的行互相替换。

插件 bundle 只有通过安装才会进入 profile。对 `.dsh/local-plugins/copy-session-id` 执行 `plugin_manager` 的 `install_bundle`：它会记下一条 `link:` 依赖，里面是该克隆的**绝对路径**，因此换到别的路径的克隆会安装自己的 link。能被跟踪的源码正是这次安装的前提。

## 开发者预览

DeepSeek Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

## 社区与支持

- 通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群！扫描下方二维码填写入群问卷，小助手会定期发送入群邀请。

<table>
  <thead>
    <tr>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

`pnpm run dev:web` 会在一个终端里完成构建、启动，并在源码修改时重建 client bundle；`make help` 列出 Web 与 Desktop 对应的 Make target。完整表格见开发指南的「应用命令」一节。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 引用

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
