export type EventHandler<T = unknown> = (payload: T) => void;

interface Subscription {
    handler: EventHandler<any>;
    once: boolean;
}

/**
 * Small synchronous event boundary modeled after the existing client's
 * MessageCenter flow. Gameplay code can later swap this for MessageCenter.
 */
export class EventBus {
    private readonly subscriptions: Map<string, Subscription[]> = new Map();

    public on<T>(event: string, handler: EventHandler<T>): () => void {
        return this.add(event, handler, false);
    }

    public once<T>(event: string, handler: EventHandler<T>): () => void {
        return this.add(event, handler, true);
    }

    public emit<T>(event: string, payload: T): void {
        const subscriptions = this.subscriptions.get(event);
        if (!subscriptions || subscriptions.length === 0) {
            return;
        }

        const snapshot = subscriptions.slice();
        for (const subscription of snapshot) {
            subscription.handler(payload);
            if (subscription.once) {
                this.off(event, subscription.handler);
            }
        }
    }

    public off<T>(event: string, handler: EventHandler<T>): void {
        const subscriptions = this.subscriptions.get(event);
        if (!subscriptions) {
            return;
        }

        const remaining = subscriptions.filter((item) => item.handler !== handler);
        if (remaining.length === 0) {
            this.subscriptions.delete(event);
        } else {
            this.subscriptions.set(event, remaining);
        }
    }

    public clear(): void {
        this.subscriptions.clear();
    }

    private add<T>(event: string, handler: EventHandler<T>, once: boolean): () => void {
        const subscriptions = this.subscriptions.get(event) || [];
        subscriptions.push({ handler, once });
        this.subscriptions.set(event, subscriptions);
        return () => this.off(event, handler);
    }
}

