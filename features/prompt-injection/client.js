/**
 * Readable standalone mirror of the `prompt-injection` Client half in the
 * aggregate bundle `dsh-plugin-pack`.
 *
 * STATUS: NOT LOADED AT RUNTIME. The Web runtime loads exactly one Client
 * module per bundle (the root `client.js`), which then pulls the package-local
 * chunk `client.prompt-injection.js` with `require.async('./client.prompt-injection.js')`.
 * The shipped copy is therefore the root `client.prompt-injection.js`; this file
 * exists only so the feature stays readable and reviewable on its own.
 *
 * MAINTENANCE CONTRACT: editing the UI here means editing it in TWO places --
 * this file and `client.prompt-injection.js` at the package root. They must stay
 * identical; where they disagree, the root chunk is what actually runs.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-pack',
  chunk: 'client.prompt-injection.js',
  factory(require) {
    const React = require('react');
    const { createElement: h, useState, useEffect } = React;
    // The module system resolves the primitives package as a baseline external,
    // so the dialog, buttons, and glyph come from the host's own controls
    // instead of hand-copied markup and a private stylesheet.
    const UI = require('@deepseek-ai/dsh-client-ui-primitives');
    const { Modal, Button, IconEditOutlineRegular } = UI;

    const NS = 'prompt-injection';
    const API = 'api/prompt-injection';
    // This plugin's own copy is Chinese in every locale: it exists to steer the
    // assistant into Chinese, so its UI must not leak English anywhere.
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

    // The one control primitives does not ship is a multi-line field, so it
    // borrows the settings field's tokens (border, radius, layer, type) inline
    // rather than through a class of its own.
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
       * Register this feature on the CALLER's context (the root client.js
       * ctx). `inject` is deliberately NOT declared here: this chunk is a plain
       * module, not a plugin row, so the root module owns service injection and
       * this function only uses the services it is handed.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'prompt-injection: dictionary');

        /** Editor dialog: the host Modal owns the mask, Escape, and focus. */
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
                // The modal layer focuses the marked control and restores the
                // invoking one on close; React autoFocus would run too early.
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
                // Pushes itself to the start of the right-aligned action row.
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
                // Primary, not danger: this action saves text, so it must not
                // read as destructive.
                variant: 'primary',
                disabled: loading || busy,
                onClick: () => void save(),
              }, busy ? t('saving') : t('save')),
            ],
          });
        }

        /** Main-panel body shown when the sidebar row switches to this panel. */
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

        /** Sidebar panel-list glyph; the host row owns layout and the click. */
        function PromptInjectionButton(props) {
          return h(IconEditOutlineRegular, {
            size: typeof props.size === 'number' ? props.size : 16,
          });
        }

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'prompt-injection',
          order: 900,
          // Without a label the host falls back to the id, which is why the row
          // showed "prompt-injection" instead of Chinese text.
          label: () => ctx.locale.bind(NS)('open'),
          // Compiled packages get no automatic shadowing priority.
          priority: -1,
          locale: NS,
        }, PromptInjectionButton));

        // The host's row button switches to the main panel of the same id and
        // throws when none is registered; provide one so the row is valid.
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
