/** Minimal Node declarations used only by the device-free test harness. */
declare module "node:crypto" {
    export const webcrypto: {
        getRandomValues<T extends ArrayBufferView>(array: T): T;
    };
}

declare module "node:module" {
    interface TestRequire {
        resolve(id: string): string;
    }

    export function createRequire(url: string): TestRequire;
}

declare module "node:fs" {
    export function readFileSync(path: string, encoding: "utf8"): string;
}

declare module "node:path" {
    export function dirname(path: string): string;
    export function join(...paths: string[]): string;
}
