/**
 * Kettu installs this as a VENDETTA plugin. The loader evaluates the bundle as
 *   `vendetta => { return <bundle-expression> }`
 * so `vendetta` is the API object in scope. The bundle references it as a free
 * global (esbuild leaves it un-renamed); our build wraps the output into a
 * single expression returning `{ default: { onLoad, onUnload, settings } }`.
 */
declare const vendetta: any;
