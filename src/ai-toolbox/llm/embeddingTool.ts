import { EmbedModel, RerankerModel } from "./models";
import type { BatchEmbeddingPollResponse, BatchQueuedResponse } from "./types";
import type { Env } from "../env";

interface EmbeddingResponse {
    shape: number[];
    data: number[][];
}

export class EmbeddingTool {
    constructor(private readonly env: Env) {
        if (!env?.AI) {
            throw new Error("Cloudflare AI binding (env.AI) is required for EmbeddingTool.");
        }
    }

    public async generateEmbedding(query: string): Promise<number[]> {
        if (!query) {
            throw new Error("Query text cannot be empty for embedding generation.");
        }

        const response: EmbeddingResponse = await this.env.AI.run(EmbedModel, {
            text: [query],
        });

        if (!response?.data?.[0]) {
            throw new Error(
                `Failed to generate embedding for query: ${query.substring(0, 100)}... Invalid response structure.`,
            );
        }

        return response.data[0];
    }

    public async requestBatchEmbeddings(
        texts: string[],
        externalReferences?: string[],
    ): Promise<BatchQueuedResponse> {
        if (!texts?.length) {
            throw new Error("At least one text string is required for batch embedding.");
        }

        if (texts.some((text) => !text)) {
            throw new Error("All text strings in the batch must be non-empty.");
        }

        if (externalReferences && externalReferences.length !== texts.length) {
            throw new Error("Length of externalReferences must match the length of texts.");
        }

        const requests = texts.map((text, index) => ({
            text: [text],
            ...(externalReferences && { external_reference: externalReferences[index] }),
        }));

        const response: BatchQueuedResponse | any = await this.env.AI.run(
            EmbedModel,
            { requests },
            { queueRequest: true },
        );

        if (response?.status !== "queued" || !response?.request_id) {
            throw new Error(`Failed to queue batch embedding request. Received status: ${response?.status}`);
        }

        return response;
    }

    public async pollBatchEmbeddingStatus(requestId: string): Promise<BatchEmbeddingPollResponse> {
        if (!requestId) {
            throw new Error("Request ID is required to poll batch status.");
        }

        const response: BatchEmbeddingPollResponse = await this.env.AI.run(EmbedModel, {
            request_id: requestId,
        });

        if (!response || !response.status) {
            throw new Error(`Received invalid poll response structure for Request ID ${requestId}.`);
        }

        if (response.status === "completed" && !Array.isArray(response.responses)) {
            throw new Error(`Completed batch embedding response for ${requestId} has invalid structure.`);
        }

        return response;
    }

    public async rerankMatches(query: string, matches: any[], contextField: string = "text"): Promise<any[]> {
        if (!query) {
            throw new Error("Query text cannot be empty for reranking.");
        }

        if (!matches?.length) {
            return [];
        }

        const rerankedMatches = await Promise.all(
            matches.map(async (match, index) => {
                try {
                    const context = match?.metadata?.[contextField] || match?.[contextField];

                    if (typeof context !== "string" || !context) {
                        return {
                            ...match,
                            score: match?.score ?? 0,
                            originalIndex: index,
                            rerankError: `Context field '${contextField}' not found or empty.`,
                        };
                    }

                    const response = await this.env.AI.run(RerankerModel, {
                        context,
                        query,
                    });

                    const newScore = typeof response?.score === "number" ? response.score : 0;

                    return {
                        ...match,
                        score: newScore,
                        originalIndex: index,
                    };
                } catch (error) {
                    return {
                        ...match,
                        score: match?.score ?? 0,
                        originalIndex: index,
                        rerankError: error instanceof Error ? error.message : String(error),
                    };
                }
            }),
        );

        return rerankedMatches.sort((a, b) => (b?.score ?? 0) - (a?.score ?? 0));
    }
}
