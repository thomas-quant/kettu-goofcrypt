/**
 * `bunny` and `definePlugin` are injected by Kettu's plugin loader as closure
 * arguments of the wrapper `(bunny, definePlugin) => { <our code>; return plugin?.default ?? plugin }`.
 * They are NOT importable — we reference them as free globals and esbuild leaves
 * them un-renamed.
 */
declare const definePlugin: <T extends object>(plugin: T) => T & { manifest: any };

declare const bunny: {
    api: {
        patcher: {
            before: (name: string, parent: any, cb: (args: any[]) => any) => () => boolean;
            after: (name: string, parent: any, cb: (args: any[], ret: any) => any) => () => boolean;
            instead: (name: string, parent: any, cb: (args: any[], orig: Function) => any) => () => boolean;
        };
        flux: {
            intercept: (cb: (payload: Record<string, any> & { type: string }) => any) => () => void;
        };
        commands: {
            registerCommand: (command: any) => () => void;
        };
    };
    plugin: {
        createStorage: <T extends object = any>() => T;
        manifest: any;
        logger: { log: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void };
    };
    metro: {
        findByProps: (...props: string[]) => any;
        findByPropsLazy: (...props: string[]) => any;
    };
    [key: string]: any;
};
