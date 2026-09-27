/**
 * 聚合 bundle `dsh-plugin-pack` 中「提示词注入」功能的包内 Client chunk。
 *
 * 为什么用 chunk：模块加载器按 boot row id 校验 bundle 的根注册，而 row id
 * 就是包名，所以根 `client.js` 只能注册 `id: 'dsh-plugin-pack'`。同一个包内
 * 的额外模块因此必须声明为 chunk：id 相同（加载器以 `<id>/<chunk>` 作为
 * 内部键），用 `chunk` 字段区分。`client-modules` 用
 * `/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/` 校验 chunk 文件名。
 *
 * 如何被加载：宿主从不主动加载。根 `client.js` 的工厂用
 * `require.async('./client.prompt-injection.js')` 拉取本文件；这是进入
 * `importChunk` 的唯一入口。根模块不来取，这里什么都不会执行。
 *
 * 暴露什么：这是一个被根工厂消费的普通模块，不是自己的插件行。
 * `materialize`（client-modules/lib/client.js:683）把工厂的返回值作为模块
 * exports，所以下面 return 的对象就是 `require.async` 解析到的值。根模块
 * 随后用自己的 ctx 调用 `apply(ctx)`，因此 locale 与 slot 注册都落在根
 * 上下文上，并使用本功能的命名空间。
 *
 * locale 命名空间为 `prompt-injection`，与相邻 chunk 的 `edit-message`
 * 命名空间互不相同，两者在同一页面不会冲突。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-pack',
  chunk: 'client.prompt-injection.js',
  factory(require) {
    const React = require('react');
    const { createElement: h, useState, useEffect } = React;
    // 模块系统把 primitives 包作为基线 external 解析，所以对话框、按钮和
    // 图标都来自宿主自己的控件，而不是手工复刻标记加私有样式表。
    const UI = require('@deepseek-ai/dsh-client-ui-primitives');
    const { Modal, Button, IconEditOutlineRegular } = UI;

    const NS = 'prompt-injection';
    const API = 'api/prompt-injection';
    // 本插件的这份字典在所有语言下都是中文：它存在的意义就是把助手引导到
    // 中文，所以它的 UI 不允许泄漏任何英文。
    const DICT = {
      en: {
        open: '提示词注入',
        title: '注入的系统提示词',
        hint: '这段文本会注入到每一轮的系统提示词中。',
        placeholder: '注入到系统提示词的指令…',
        save: '保存',
        cancel: '取消',
        saving: '保存中…',
        reset: '恢复默认',
        failed: '保存失败',
        loadFailed: '读取失败',
      },
      zh: {
        open: '提示词注入',
        title: '注入的系统提示词',
        hint: '这段文本会注入到每一轮的系统提示词中。',
        placeholder: '注入到系统提示词的指令…',
        save: '保存',
        cancel: '取消',
        saving: '保存中…',
        reset: '恢复默认',
        failed: '保存失败',
        loadFailed: '读取失败',
      },
    };

    // primitives 没有发布多行输入控件，所以这里内联借用设置页字段的
    // token（边框、圆角、层级、字号），而不是通过某个类名。
    const AREA_STYLE = {
      width: '100%',
      boxSizing: 'border-box',
      minHeight: 160,
      maxHeight: 380,
      resize: 'vertical',
      padding: '8px 10px',
      border: '0.5px solid var(--dsw-alias-border-l4)',
      borderRadius: 'var(--dsw-radius-md)',
      background: 'var(--dsw-alias-bg-layer-3)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 13,
      lineHeight: 1.5,
    };
    const ERROR_STYLE = {
      margin: '0 0 8px',
      fontSize: 12,
      lineHeight: 1.5,
      color: 'var(--dsw-alias-state-error-primary)',
    };

    function errorText(error) {
      return error && error.message ? String(error.message) : String(error);
    }

    async function apiGet() {
      const response = await fetch(API, { method: 'GET' });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      return await response.json();
    }

    async function apiPost(text) {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      return await response.json();
    }

    return {
      /**
       * 在调用方的上下文（根 client.js 的 ctx）上注册本功能。这里故意不声明
       * `inject`：本 chunk 是普通模块而非插件行，Service 注入由根模块持有，
       * 本函数只使用被交到手里的服务。
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'prompt-injection: dictionary');

        /** 编辑对话框：遮罩、Escape 与焦点都由宿主 Modal 负责。 */
        function PromptDialog(props) {
          const t = props.t;
          const [text, setText] = useState('');
          const [fallback, setFallback] = useState('');
          const [busy, setBusy] = useState(false);
          const [loading, setLoading] = useState(true);
          const [error, setError] = useState(null);

          useEffect(() => {
            let active = true;
            apiGet().then((data) => {
              if (!active) return;
              setText(data.text ?? '');
              setFallback(data.default ?? '');
              setLoading(false);
            }, (failure) => {
              if (!active) return;
              setError(`${t('loadFailed')}: ${errorText(failure)}`);
              setLoading(false);
            });
            return () => {
              active = false;
            };
          }, [t]);

          const save = async () => {
            setBusy(true);
            setError(null);
            try {
              await apiPost(text);
              props.onClose();
            } catch (failure) {
              setError(`${t('failed')}: ${errorText(failure)}`);
            } finally {
              setBusy(false);
            }
          };

          return h(Modal, {
            open: true,
            onClose: props.onClose,
            title: t('title'),
            description: t('hint'),
            closeLabel: t('cancel'),
            children: [
              error === null ? null : h('p', { key: 'error', style: ERROR_STYLE }, error),
              h('textarea', {
                key: 'area',
                // modal 层会聚焦带此标记的控件，关闭时把焦点还给触发者；
                // React 的 autoFocus 跑得太早，用不了。
                'data-modal-autofocus': true,
                style: AREA_STYLE,
                value: text,
                placeholder: t('placeholder'),
                spellCheck: false,
                disabled: loading,
                onChange: (event) => setText(event.target.value),
              }),
            ],
            footer: [
              h(Button, {
                key: 'reset',
                variant: 'ghost',
                size: 'sm',
                // 把自己推到右对齐操作行的最前面。
                style: { marginRight: 'auto' },
                disabled: loading || busy,
                onClick: () => setText(fallback),
              }, t('reset')),
              h(Button, {
                key: 'cancel',
                variant: 'outline',
                disabled: busy,
                onClick: props.onClose,
              }, t('cancel')),
              h(Button, {
                key: 'save',
                // primary 而非 danger：这个动作只是保存文本，不能被读成破坏性操作。
                variant: 'primary',
                disabled: loading || busy,
                onClick: () => void save(),
              }, busy ? t('saving') : t('save')),
            ],
          });
        }

        /** 侧边栏行切换到本面板时显示的主面板内容。 */
        function PromptInjectionPanel(props) {
          const t = props.t;
          const [editing, setEditing] = useState(false);
          return h(
            'div',
            { style: { boxSizing: 'border-box', minHeight: 0, padding: '32px clamp(24px, 4vw, 48px) 48px' } },
            h('h1', {
              style: {
                margin: '0 0 8px',
                fontSize: 20,
                fontWeight: 500,
                lineHeight: 1.4,
                color: 'var(--dsw-alias-label-primary)',
              },
            }, t('title')),
            h('p', {
              style: {
                margin: '0 0 20px',
                fontSize: 13,
                lineHeight: 1.6,
                color: 'var(--dsw-alias-label-secondary)',
              },
            }, t('hint')),
            h(Button, { variant: 'outline', onClick: () => setEditing(true) }, t('open')),
            editing ? h(PromptDialog, { t, onClose: () => setEditing(false) }) : null,
          );
        }

        /** 侧边栏面板列表的图标；布局与点击都由宿主的行负责。 */
        function PromptInjectionButton(props) {
          return h(IconEditOutlineRegular, {
            size: typeof props.size === 'number' ? props.size : 16,
          });
        }

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'prompt-injection',
          order: 900,
          // 不给 label 的话宿主会回退显示 id，这就是行名曾经显示成
          // "prompt-injection" 而不是中文的原因。
          label: () => ctx.locale.bind(NS)('open'),
          // 编译安装的包没有自动的遮蔽优先级。
          priority: -1,
          locale: NS,
        }, PromptInjectionButton));

        // 宿主的行按钮会切换到同 id 的主面板，没有注册面板时它会抛错；
        // 提供一个，让这个行是有效的。
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'prompt-injection',
          priority: -1,
          locale: NS,
        }, PromptInjectionPanel));
      },
    };
  },
});
