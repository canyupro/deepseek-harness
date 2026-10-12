# Copy Session ID

Adds a **Copy Session ID** row to a session's `⋯` menu in the workspace sidebar. Selecting it copies that session's ID to the clipboard, so a session can be located without reading its log.

## Install

The bundle is installed into a DSH profile with the plugin manager; do not reproduce these steps with shell commands.

```
plugin_manager action: install_bundle
  target: /absolute/path/to/copy-session-id
```

`target` is the **absolute directory** of this package. Installing a local directory links the checkout, so this directory must stay where it is.

Rollback takes the **installed package name** rather than a path:

```
plugin_manager action: remove_bundle
  target: '@local/copy-session-id'
```

The profile row is inserted by `cordis.patch.yml`. It carries no `config`: every setting this bundle has is fixed in code.

## What it depends on

| Dependency | Value | Why |
| --- | --- | --- |
| Slot | `sidebar.workspaces.session.menu.item` | Declared by ui-workspace. Without that plugin mounted, this row never renders. |
| Row id | `copy-session-id`, `order: 500` | Lands after the shipped pin (100), rename (200), fork (300), and archive (400) rows. |
| Owner props | `sessionId`, `displayTitle` | The copied value is `sessionId`, verbatim. |
| Hook | `useMenuOpenState` | The menu closes only after the clipboard write succeeds. |
| Locale namespace | `copy-session-id` | Holds `copySessionId` and `copySessionIdFailed`, in `zh` and `en`. |
| Browser modules | `react`, `@deepseek-ai/dsh-client-ui-primitives` | Both are baseline seeds in the frozen module table (`packages/client/web/src/platform.ts:9,12`), so `require` resolves them without a `dsh.client.external` request. `ui-primitives` supplies `MenuItemButton` and `IconCopyOutlineRegular`. |

An entry that declares `locale:` renders only when that namespace has a loaded locale face, so `client.js` registers its dictionary before registering the row. A missing dictionary is an assembly failure for the row, not a silent fallback.

## Files

| File | Role |
| --- | --- |
| `index.js` | Host half. The patch row imports this package root; it holds no behavior. |
| `client.js` | Browser half. Registers the dictionary and the menu row. |
| `cordis.patch.yml` | Inserts the single profile row. |
| `locale/en.json`, `locale/zh.json` | Display metadata (`meta.title`, `meta.description`) read by Plugin Manager and Settings without activating the plugin. They are **not** the runtime dictionary. |
| `icon.svg` | Plugin Manager icon. |

The runtime dictionary is declared in code inside `client.js` as `ctx.locale.register('copy-session-id', { zh, en })`, because a dynamic bundle's `require` resolves module-table specifiers only and cannot read a relative JSON file.

## Known limitations

- **A failed copy changes the row's label and nothing else.** The row renders the host `MenuItemButton`, which accepts exactly seven props (`children`, `shortcut`, `icon`, `disabled`, `danger`, `separatorBefore`, `onSelect`) and spreads no rest attributes onto its internal button, so `aria-live` cannot reach that element. A clipboard failure is therefore visible — the row relabels to the failure string and stays open — but is not announced to a screen reader. The row is not wrapped in an extra element, because that would add a level inside the menu list and break its consistency with the rows around it.
- **Row structure and styling belong to the host.** `role="menuitem"`, the disabled state, and every visual detail are produced by `MenuItemButton` (`packages/client/ui-primitives/src/Menu.tsx:84-104`) and its CSS modules; this bundle passes only `icon` and `onSelect`. If the row's appearance or behavior looks wrong, check how the host component is being used and how the row is assembled before changing anything in this package.
- **The source directory is a load-bearing link.** Installing a local directory links it into the profile rather than copying it, so moving or deleting this directory breaks the installed bundle. Inside this repository, `git clean -fd` removes `.dsh/local-plugins/` and with it the installed package.
- **Edits to bundle files are picked up automatically only where Client HMR runs.** Bundle bytes are read from disk when the boot graph is composed, and `rev` comes from the file's mtime/ctime/size. In a profile with Client HMR enabled (this desktop profile is, via `@deepseek-ai/dsh-web-app`), editing a file is picked up automatically and pushed to the page — **no reinstall needed**. Without that plugin, recompose by reinstalling the bundle. Changing the **package name** always requires a restart to load a new module generation.
