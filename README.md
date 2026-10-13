# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

> **This repository is a personal fork.** [`canyupro/deepseek-harness`](https://github.com/canyupro/deepseek-harness) is maintained by an individual developer who builds a personal harness on top of the upstream project; it is not a DeepSeek AI release, and it is not the place to report the upstream project's issues. Upstream is [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness). This fork works on `dev`, its only long-lived branch: plugins, team configuration, skills, and local settings live there, and `master` follows upstream. Because this is personal work, `dev` is used directly — no feature-branch, review, or release flow — and it is rebased or merged forward from upstream when convenient.

## Running this fork on another machine

A clone of `dev` carries the harness code, the local plugin bundle under [`.dsh/local-plugins/`](.dsh/local-plugins/), the Agent Teams roster in [`.dsh/team.json`](.dsh/team.json), this fork's deployment values in [`.dsh/profile.patch.yml`](.dsh/profile.patch.yml), and the personal-home seed under [`.dsh/dev-home/`](.dsh/dev-home/). Build outputs, credentials, and every session stay on the machine that created them.

```sh
git clone https://github.com/canyupro/deepseek-harness.git && cd deepseek-harness
git switch dev
pnpm install
pnpm run dev:desktop
```

A home that lacks them receives the tracked copies before the app starts: `AGENTS.md`, `.agent-presets/`, and `skills/` from `.dsh/dev-home/`, and `profiles/desktop/cordis.patch.yml` from `.dsh/profile.patch.yml`. The seed copies only what is missing, so a home that already holds these files keeps them; `DSH_DESKTOP_SEED=0` starts from the home as it is.

Provide the provider keys the profile names — `MINIMAX_CN_API_KEY`, `COMMANDCODE_API_KEY`, `YJGORK_API_KEY`, `OPENCODE1_API_KEY`, and `DEEPSEEK_API_KEY` — as launcher environment variables or in the gitignored root `.env`. A packaged install that does not run the development launcher applies the same rows with `pnpm dsh desktop --patch .dsh/profile.patch.yml`, or merges them into `$DSH_HOME/profiles/desktop/cordis.patch.yml`: the format is identical and rows replace each other by id.

The plugin bundle reaches a profile only through an install. Run the `plugin_manager` `install_bundle` action on `.dsh/local-plugins/copy-session-id`: it records a `link:` dependency holding the absolute path of that checkout, so a clone at a different path installs its own link. The tracked source is what makes that install possible.

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/4MrtZUhpxg">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
