/**
 * Client half of the `copy-session-id` bundle: one row in a Session's "..."
 * menu that copies that row's Session id to the host clipboard.
 *
 * The dictionaries live here rather than in sibling JSON files because the
 * dynamic `require` handed to a module factory resolves module-table specifiers
 * only and never relative paths, so a relative import of `locale/*.json` would
 * throw instead of loading. They are registered before the slot contribution:
 * an entry that declares `locale:` renders against the installed locale face, and
 * a declared namespace with no registered dictionaries is an assembly failure,
 * not a missing row.
 */
window.__ModuleLoader__.load({
  id: '@local/copy-session-id',
  factory(require) {
    const React = require('react')
    const { MenuItemButton, IconCopyOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    /** Namespace this bundle owns; no other package registers it. */
    const NAMESPACE = 'copy-session-id'

    const DICT_ZH = {
      copySessionId: '复制会话 ID',
      copySessionIdFailed: '复制失败',
    }
    const DICT_EN = {
      copySessionId: 'Copy Session ID',
      copySessionIdFailed: 'Copy failed',
    }

    /**
     * Place text on the host clipboard and report whether the host accepted it.
     * The async Clipboard API is preferred; a rejection or an absent API falls
     * back to a temporary off-screen textarea and `execCommand('copy')`, the
     * only remaining path once the async API is unusable.
     * @param {string} text - the exact text to place on the clipboard.
     * @returns {Promise<boolean>} true only when the host accepted the write.
     */
    async function writeClipboard(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(text)
          return true
        } catch {
          // Denied permission or document policy: fall through to execCommand.
        }
      }
      const exec = typeof document.execCommand === 'function'
        ? document.execCommand.bind(document)
        : undefined
      if (exec === undefined) return false
      const el = document.createElement('textarea')
      el.value = text
      el.setAttribute('readonly', '')
      el.style.position = 'fixed'
      el.style.left = '-9999px'
      document.body.appendChild(el)
      el.select()
      try {
        return exec('copy')
      } catch {
        return false
      } finally {
        el.remove()
      }
    }

    /**
     * The row: copies `sessionId`, then dismisses the menu. A failed write
     * keeps the menu open and relabels the row in place, so the operator sees
     * the failure and can retry without reopening the menu.
     * @param {{ sessionId: string, t: (key: string) => string, useMenuOpenState: () => readonly [boolean, (open: boolean) => void] }} props - owner props, the locale seat, and the owner's menu open state.
     * @returns {import('react').ReactElement} the menu row.
     */
    function CopySessionIdMenuItem(props) {
      const { sessionId, t, useMenuOpenState } = props
      const [, setOpen] = useMenuOpenState()
      const [failed, setFailed] = React.useState(false)
      const onSelect = () => {
        // Clear the previous outcome first so a retry never reports a stale one.
        setFailed(false)
        void writeClipboard(sessionId).then((written) => {
          if (written) setOpen(false)
          else setFailed(true)
        })
      }
      return h(
        MenuItemButton,
        { icon: h(IconCopyOutlineRegular), onSelect },
        failed ? t('copySessionIdFailed') : t('copySessionId'),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(NAMESPACE, { zh: DICT_ZH, en: DICT_EN }),
          'copy-session-id: dictionaries',
        )
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register(
          {
            name: 'sidebar.workspaces.session.menu.item',
            id: 'copy-session-id',
            order: 500,
            locale: NAMESPACE,
          },
          CopySessionIdMenuItem,
        ))
      },
    }
  },
})
