/**
 * Readable standalone mirror of the `delete-session` Client half in the
 * aggregate bundle `dsh-plugin-pack`.
 *
 * STATUS: NOT LOADED AT RUNTIME. The Web runtime loads exactly one Client
 * module per bundle (the root `client.js`), which then pulls the package-local
 * chunk `client.delete-session.js` with `require.async('./client.delete-session.js')`.
 * The shipped copy is therefore the root `client.delete-session.js`; this file
 * exists only so the feature stays readable and reviewable on its own.
 *
 * MAINTENANCE CONTRACT: editing the UI here means editing it in TWO places --
 * this file and `client.delete-session.js` at the package root. They must stay
 * identical; where they disagree, the root chunk is what actually runs.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-pack',
  chunk: 'client.delete-session.js',
  factory(require) {
    const React = require('react');
    const { createElement: h, useState, useLayoutEffect, useRef } = React;

    // The host's own UI atoms: every control below is a shipped component, so
    // the plugin inherits the real product styling (tokens, hover, radius,
    // focus) instead of restating it in a private stylesheet.
    const UI = require('@deepseek-ai/dsh-client-ui-primitives');
    const {
      Button,
      Tooltip,
      Tag,
      Modal,
      MenuItemButton,
      IconTrashOutlineRegular,
    } = UI;

    const NS = 'edit-message';

    const DICT = {
      en: {
        delete: 'Delete session',
        deleteTitle: 'Permanently delete this session?',
        deleteBody: 'This removes the stored conversation permanently. It cannot be undone.',
        deleteConfirm: 'Delete',
        deleteCancel: 'Cancel',
        deleteFailed: 'Delete failed',
      },
      zh: {
        delete: '删除会话',
        deleteTitle: '永久删除这个会话？',
        deleteBody: '这会永久删除该会话的存储记录，无法撤销。',
        deleteConfirm: '删除',
        deleteCancel: '取消',
        deleteFailed: '删除失败',
      },
    };

    function errorText(error) {
      return error && error.message ? String(error.message) : String(error);
    }

    /**
     * Find the host's row-icon button class from a sibling of `button`.
     *
     * The archive and pin buttons in this same strip are plain `<button>`s
     * styled by a CSS-module class whose name is build-hashed (`ozLDBG_iconButton`
     * today, something else after any rebuild). The slot contract passes no
     * styling handle down, so the only stable way to match them is to read the
     * class off a rendered sibling — hardcoding the hash would break on the
     * next release.
     *
     * Walks up a few levels because the slot may wrap our entry in an extra
     * element; stops at the first ancestor holding more than one button, so it
     * can never latch onto an unrelated control elsewhere in the sidebar.
     *
     * @returns the class name, or undefined when no sibling carries one.
     */
    function findIconButtonClass(button) {
      if (button === null || button === undefined) return undefined;
      let node = button.parentElement;
      for (let depth = 0; node !== null && node !== undefined && depth < 2; depth += 1, node = node.parentElement) {
        const buttons = node.querySelectorAll('button');
        const others = [...buttons].filter((candidate) => candidate !== button);
        // No other button here means this is a wrapper, not the strip: keep
        // climbing. Once other buttons appear this IS the strip, so a miss
        // ends the search instead of climbing into unrelated markup.
        if (others.length === 0) continue;
        for (const sibling of others) {
          for (const name of sibling.classList) {
            if (/iconButton/i.test(name)) return name;
          }
        }
        return undefined;
      }
      return undefined;
    }

    /** The host's row-icon button class, read from a rendered sibling. */
    function useSiblingIconButtonClass(ref) {
      const [className, setClassName] = useState(undefined);
      useLayoutEffect(() => {
        const found = findIconButtonClass(ref.current);
        if (found !== undefined) setClassName(found);
      }, [ref]);
      return className;
    }

    return {
      /**
       * Register this feature on the CALLER's context (the root client.js
       * ctx). `inject` is deliberately NOT declared here: this chunk is a plain
       * module, not a plugin row, so the root module owns service injection and
       * this function only uses the services it is handed.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'edit-message: dictionary');

        /**
         * Permanently delete one session: run the Host command, then keep
         * dropping the list row until it is really gone (a late baseline can
         * put it back, so one refresh is not enough).
         */
        const deleteSession = async (sessionId) => {
          if (sessionId === undefined) throw new Error('no session');
          await ctx.sessions.using(sessionId, { source: 'edit-message' }, async (reference) => {
            const result = await reference.binding.session.command(`/delete-session ${sessionId}`);
            if (!result.ok) {
              throw new Error(result.error ? `${result.error.code}: ${result.error.message}` : 'command failed');
            }
          });
          for (let attempt = 0; attempt < 6; attempt += 1) {
            if (typeof ctx.sessions.refresh === 'function') {
              await ctx.sessions.refresh();
            }
            if (typeof ctx.sessions.handleSessionRemoved === 'function') {
              ctx.sessions.handleSessionRemoved(sessionId);
            }
            if (ctx.sessions.list.getSnapshot().byId[sessionId] === undefined) break;
            await new Promise((resolve) => window.setTimeout(resolve, 120));
          }
        };

        /**
         * Dialog target shared by the row button and the dropdown menu row.
         *
         * The menu unmounts its rows the moment it closes, so a dialog owned by
         * a menu item would die with it and never appear. Keeping the pending
         * id here lets an always-mounted overlay own the dialog instead.
         */
        const confirm = {
          sessionId: undefined,
          listeners: new Set(),
          subscribe(listener) {
            this.listeners.add(listener);
            return () => {
              this.listeners.delete(listener);
            };
          },
          getSnapshot() {
            return this.sessionId;
          },
          set(next) {
            if (this.sessionId === next) return;
            this.sessionId = next;
            for (const listener of this.listeners) listener();
          },
        };

        /** The delete confirmation, built from the shipped Modal. */
        function DeleteDialog(props) {
          const t = props.t;
          const sessionId = props.sessionId;
          const [busy, setBusy] = useState(false);
          const [error, setError] = useState(null);

          const run = async () => {
            setBusy(true);
            setError(null);
            try {
              await deleteSession(sessionId);
              confirm.set(undefined);
            } catch (failure) {
              setError(`${t('deleteFailed')}: ${errorText(failure)}`);
            } finally {
              setBusy(false);
            }
          };

          // `open` stays true for the caller's chosen id; the Modal handles the
          // mask, Escape, focus trapping, and body portal on its own.
          return h(Modal, {
            open: sessionId !== undefined,
            onClose: () => confirm.set(undefined),
            title: t('deleteTitle'),
            closeLabel: t('deleteCancel'),
            description: t('deleteBody'),
            footer: h(
              React.Fragment,
              null,
              h(Button, {
                variant: 'outline',
                onClick: () => confirm.set(undefined),
                disabled: busy,
              }, t('deleteCancel')),
              h(Button, {
                variant: 'primary',
                icon: h(IconTrashOutlineRegular, { size: 14 }),
                disabled: busy,
                onClick: () => void run(),
              }, t('deleteConfirm')),
            ),
          }, error === null ? null : h(Tag, { tone: 'danger' }, error));
        }

        /** Always-mounted owner of the delete confirmation dialog. */
        function DeleteConfirmHost(props) {
          const t = props.t;
          const sessionId = React.useSyncExternalStore(confirm.subscribe.bind(confirm), confirm.getSnapshot.bind(confirm));
          return h(DeleteDialog, { t, sessionId });
        }

        /** Row in the session "..." dropdown menu: permanently delete. */
        function DeleteSessionMenuItem(props) {
          const t = props.t;
          const sessionId = props.sessionId;
          const closeMenu = props.useMenuOpenState
            ? props.useMenuOpenState()[1]
            : undefined;

          return h(
            MenuItemButton,
            {
              danger: true,
              icon: h(IconTrashOutlineRegular, { size: 14 }),
              onSelect: () => {
                if (typeof closeMenu === 'function') closeMenu(false);
                confirm.set(sessionId);
              },
            },
            t('delete'),
          );
        }

        /**
         * Hover action in one sidebar Session row: permanently delete it.
         *
         * Deliberately a plain `<button>` wearing the host's own row-icon class
         * rather than a primitives `Button`: the shipped archive/pin actions in
         * this strip are 16×16 icon buttons with no padding, and `Button`
         * carries its own control geometry (28px tall, 14px inline padding)
         * that would make this one visibly larger than its neighbours. The
         * tooltip matches theirs too — bottom-aligned, right-aligned, 500ms
         * delay — so hovering across the strip behaves identically.
         */
        function DeleteSessionRowAction(props) {
          const t = props.t;
          const sessionId = props.sessionId;
          const ref = useRef(null);
          const hostClass = useSiblingIconButtonClass(ref);
          return h(
            Tooltip,
            { label: t('delete'), side: 'bottom', align: 'end', delayMs: 500 },
            h('button', {
              ref,
              type: 'button',
              className: hostClass,
              // Until the sibling class is read (first paint, or a host that
              // renamed it), reproduce the shipped geometry inline so the strip
              // never jumps between two sizes.
              style: hostClass === undefined ? {
                boxSizing: 'border-box',
                width: '16px',
                height: '16px',
                padding: '0',
                border: 'none',
                background: 'transparent',
                borderRadius: 'var(--dsw-radius-xs)',
                color: 'var(--dsw-alias-label-tertiary)',
                cursor: 'pointer',
                display: 'inline-flex',
                flex: 'none',
                alignItems: 'center',
                justifyContent: 'center',
              } : undefined,
              'aria-label': t('delete'),
              onClick: () => confirm.set(sessionId),
            }, h(IconTrashOutlineRegular, { size: 14 })),
          );
        }

        ctx.slots.inject('sidebar.workspaces.session.row.action', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.row.action',
          id: 'edit-message-delete-session',
          order: 500,
          locale: NS,
        }, DeleteSessionRowAction));

        // Same action as a row of the session "..." dropdown menu.
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'edit-message-delete-session',
          order: 500,
          locale: NS,
        }, DeleteSessionMenuItem));

        // The confirm dialog lives here so it survives the menu closing.
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'edit-message-delete-dialog',
          order: 900,
          locale: NS,
        }, DeleteConfirmHost));
      },
    };
  },
});
