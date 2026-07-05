import cron from "node-cron";

let onSubscriptionChangedCallback: (() => void) | undefined;

/**
 * Register a callback to be triggered when report subscriptions are modified.
 */
export function registerSubscriptionChangedCallback(cb: () => void) {
    onSubscriptionChangedCallback = cb;
}

/**
 * Trigger the registered callback to signal subscription updates.
 */
export function notifySubscriptionChanged() {
    if (onSubscriptionChangedCallback) {
        onSubscriptionChangedCallback();
    }
}
