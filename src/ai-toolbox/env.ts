export interface AiBinding {
    run: (model: string, options: any, flags?: { queueRequest?: boolean }) => Promise<any>;
}

export interface Env {
    AI: AiBinding;
    [key: string]: any;
}

export interface ExtendedEnv extends Env {
    VECTORIZE_INDEX?: {
        query: (vector: number[], options: { topK: number }) => Promise<any>;
    };
    BROWSER?: unknown;
    AUTH_SERVICE?: unknown;
    [key: string]: any;
}
