/**
 * `dsh-plugin-delete-session` 的 Client 根模块。
 *
 * 本包只有一个组件行（见 cordis.patch.yml），Host 与 Client 由同一根行承载：
 * 在插件页停用本插件时，收录扫描跳过该行，这里的 UI 与 Host 命令一起下线。
 *
 * Client 模块系统按 boot row id 校验根注册：row id 就是包名（bundle URL 形如
 * `<row.id>/client.js`），所以这里的注册 id 必须等于包名，否则加载器报
 * "loaded without registering" 并抛错，UI 挂不上。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-delete-session',
  factory(require) {
    const React = require('react');
    const { createElement: h, useState, useLayoutEffect, useRef } = React;

    // 宿主自己的 UI 原子组件：下面每个控件都是官方发布的组件，插件因此
    // 直接继承真实的产品样式（token、hover、圆角、焦点），无需自建样式表。
    const UI = require('@deepseek-ai/dsh-client-ui-primitives');
    const {
      Button,
      Tooltip,
      Tag,
      Modal,
      MenuItemButton,
      IconTrashOutlineRegular,
    } = UI;

    const NS = 'delete-session';

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
     * 从 `button` 的兄弟节点里找出宿主的行图标按钮样式类。
     *
     * 同一条操作条里的归档、置顶按钮都是普通 `<button>`，样式来自一个
     * CSS-module 类，类名带构建哈希（今天是 `ozLDBG_iconButton`，重新构建
     * 后就会变）。slot 契约不传递样式句柄，所以唯一稳定的匹配方式是渲染后
     * 从兄弟节点上读取类名 —— 写死哈希下一次发版就会失效。
     *
     * 向上多走几层是因为 slot 可能把我们的入口再包一层元素；遇到第一个
     * 拥有多个按钮的祖先就停，绝不会误抓侧边栏里无关的控件。
     *
     * @returns 找到的类名；没有兄弟节点带类名时为 undefined。
     */
    function findIconButtonClass(button) {
      if (button === null || button === undefined) return undefined;
      let node = button.parentElement;
      for (let depth = 0; node !== null && node !== undefined && depth < 2; depth += 1, node = node.parentElement) {
        const buttons = node.querySelectorAll('button');
        const others = [...buttons].filter((candidate) => candidate !== button);
        // 这里没有别的按钮说明它只是包装层而非操作条本体：继续向上。
        // 一旦出现其他按钮，这层就是操作条 —— 找不到就到此为止，
        // 不再向上爬进无关的标记结构。
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

    /** 宿主的行图标按钮样式类，渲染后从兄弟节点读取。 */
    function useSiblingIconButtonClass(ref) {
      const [className, setClassName] = useState(undefined);
      useLayoutEffect(() => {
        const found = findIconButtonClass(ref.current);
        if (found !== undefined) setClassName(found);
      }, [ref]);
      return className;
    }

    return {
      /** 本模块需要的宿主 Client Service。 */
      inject: ['slots', 'sessions', 'locale'],

      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'delete-session: dictionary');

        /**
         * 永久删除一个会话：执行 Host 命令，然后反复把列表行移除直到真的
         * 消失（迟到的基线快照可能把它加回来，所以刷新一次并不够）。
         */
        const deleteSession = async (sessionId) => {
          if (sessionId === undefined) throw new Error('no session');
          await ctx.sessions.using(sessionId, { source: 'delete-session' }, async (reference) => {
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
         * 行按钮与下拉菜单行共用的对话框目标。
         *
         * 菜单关闭的瞬间会卸载自己的菜单行，所以由菜单项持有对话框的话，
         * 对话框会跟着菜单一起死掉、永远显示不出来。把待删除的会话 id
         * 保存在这里，让一个常驻挂载的浮层来拥有对话框。
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

        /** 删除确认对话框，由官方 Modal 构建。 */
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

          // `open` 对调用方选定的 id 保持 true；遮罩、Escape、焦点圈定和
          // body 传送门都由 Modal 自己处理。
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

        /** 删除确认对话框的常驻挂载拥有者。 */
        function DeleteConfirmHost(props) {
          const t = props.t;
          const sessionId = React.useSyncExternalStore(confirm.subscribe.bind(confirm), confirm.getSnapshot.bind(confirm));
          return h(DeleteDialog, { t, sessionId });
        }

        /** 会话「...」下拉菜单中的行：永久删除。 */
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
         * 侧边栏会话行上的悬浮操作：永久删除该会话。
         *
         * 故意用穿着宿主行图标类名的普通 `<button>`，而不是 primitives 的
         * `Button`：同一条操作条里官方的归档/置顶按钮都是无内边距的 16×16
         * 图标按钮，而 `Button` 自带控件几何（28px 高、14px 左右内边距），
         * 会让这个按钮明显比邻居大。tooltip 也与它们一致 —— 底对齐、
         * 右对齐、500ms 延迟 —— 悬停划过整条操作条的手感完全相同。
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
              // 在兄弟节点类名被读取到之前（首次绘制，或宿主改名后），
              // 内联复刻官方几何，操作条不会在两种尺寸之间跳动。
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
          id: 'delete-session',
          order: 500,
          locale: NS,
        }, DeleteSessionRowAction));

        // 同一个动作，作为会话「...」下拉菜单的一行。
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'delete-session',
          order: 500,
          locale: NS,
        }, DeleteSessionMenuItem));

        // 确认对话框挂在这里，这样菜单关闭后它仍存活。
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'delete-session-dialog',
          order: 900,
          locale: NS,
        }, DeleteConfirmHost));
      },
    };
  },
});
