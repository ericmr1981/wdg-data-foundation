const handlers = new Map();
export function registerTaskHandler(type, handler) {
    handlers.set(type, handler);
}
export function getHandler(type) {
    return handlers.get(type) ?? null;
}
export function listRegisteredTypes() {
    return [...handlers.keys()];
}
