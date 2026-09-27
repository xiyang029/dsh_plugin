/**
 * Client entry (root module) of the aggregate bundle `dsh-plugin-pack`.
 *
 * WHY THIS FILE REGISTERS `id: 'dsh-plugin-pack'` AND NOTHING ELSE
 * ---------------------------------------------------------------
 * The module system keys a bundle's root registration by its boot row id:
 * `arrive()` reads `const { id } = row` (client-modules/lib/client.js:611) and
 * only accepts a bundle whose script registered exactly that id (:624, :640).
 * A boot row's id IS the package name (its bundle URL is `<row.id>/client.js`,
 * :484), so the root registration id must equal the package name. Registering
 * `'dsh-plugin-pack#<feature>'` here would fail arrival: the loader would report
 * "loaded without registering" and throw, and NO UI would mount.
 *
 * Extra modules in the same package therefore use the chunk mechanism:
 * `register()` (:570-572) derives the internal key as `<id>/<chunk>` when a
 * `chunk` field is present, so `{ id: 'dsh-plugin-pack', chunk: 'client.x.js' }`
 * is the supported way to add a second module without breaking arrival.
 *
 * HOW THE CHUNKS ARRIVE (source-verified)
 * ---------------------------------------
 * The host never auto-loads chunks. `makeRequire` (:696-715) hands each factory
 * a `require` carrying `require.async`, whose relative branch (:707-713) slices
 * `"./"` off the specifier, validates it against CLIENT_CHUNK (:470), and calls
 * `importChunk(ownerId, fileName)` (:716-742). That builds the URL from the
 * owner row (:480-486) and requires the script to register the internal key
 * `chunkId(ownerId, fileName)` (:718, checked :739).
 *
 * So each chunk is pulled from HERE, inside `apply`, via
 * `require.async('./client.<feature>.js')` — the same pattern the shipped
 * sidebar-terminal bundle uses (ui-sidebar-terminal/lib/client.js:167:
 * `react.lazy(async () => ({ default: (await require.async("./client.terminal.js")).TerminalBody }))`)
 * and sidebar-documentpreview uses (lib/client.js:4883). Because `materialize`
 * (:683) stores whatever the chunk factory RETURNS as that module's exports
 * (`exports: registered.factory(...)`), a chunk exposes values by returning an
 * object, exactly like the shipped chunks (`exports.TerminalBody = TerminalBody;
 * return module.exports`).
 *
 * Each chunk therefore returns `{ apply... }`, and this file drives it with the
 * root ctx. Locale registration and slot registration happen on the root ctx
 * but under each feature's own namespace ('edit-message' and
 * 'prompt-injection'), so the two coexist in one page without colliding.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-pack',
  factory(require) {
    /**
     * Per-feature switch inside the bundle. `false` skips pulling that feature's
     * chunk, so its locale namespace and slots are never registered; the other
     * feature is unaffected. The bundle as a whole is switched on and off
     * through its single bundle row -- there is no per-feature install unit.
     */
    const ENABLED = { 'delete-session': true, 'prompt-injection': true };

    return {
      /**
       * Host services this Client half needs. The two features' requirements
       * are declared as a union: `sessions` is used only by delete-session, and
       * an unused service is never a hard dependency of anything.
       */
      inject: ['slots', 'sessions', 'locale'],
      async apply(ctx) {
        // Both chunks are pulled here, inside apply, so their factories register
        // before the loader looks for the key `dsh-plugin-pack/<chunk>`.
        if (ENABLED['delete-session'] === true) {
          const deleteSession = await require.async('./client.delete-session.js');
          deleteSession.apply(ctx);
        }
        if (ENABLED['prompt-injection'] === true) {
          const promptInjection = await require.async('./client.prompt-injection.js');
          promptInjection.apply(ctx);
        }
      },
    };
  },
});
