import type { StructuredModel } from "./models";

export interface StructuredResponse<T> {
    success: boolean;
    modelUsed: StructuredModel;
    structuredResult: T | null;
    error?: string;
    isChunked?: boolean;
}

export interface BatchQueuedResponse {
    status: "queued";
    model: string;
    request_id: string;
}

export interface BatchEmbeddingResultItem {
    id: number;
    result?: { shape: number[]; data: number[][] };
    success: boolean;
    error?: string;
    external_reference?: string | null;
}

export interface BatchEmbeddingResult {
    responses: BatchEmbeddingResultItem[];
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
    status?: "completed";
}

export interface BatchStructuredResultItem<T> {
    id: number;
    result?: { response: T | any };
    success: boolean;
    error?: string;
    external_reference?: string | null;
}

export interface BatchStructuredResult<T> {
    responses: BatchStructuredResultItem<T>[];
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
    status?: "completed";
}

export interface BatchIntermediateStatus {
    status: "queued" | "running";
    request_id: string;
    model: string;
    responses?: never;
}

export type BatchEmbeddingPollResponse = BatchEmbeddingResult | BatchIntermediateStatus;

export type BatchStructuredPollResponse<T> = BatchStructuredResult<T> | BatchIntermediateStatus;
