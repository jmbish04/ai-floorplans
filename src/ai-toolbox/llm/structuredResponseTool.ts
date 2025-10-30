import type { ZodObject, ZodSchema, z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import type { Env } from "../env";
import {
    Hermes2Pro,
    Llama3_3,
    Llama4Scout,
    MistralSmall3_1,
    type StructuredModel,
} from "./models";
import type {
    BatchQueuedResponse,
    BatchStructuredPollResponse,
    BatchStructuredResult,
    BatchStructuredResultItem,
    StructuredResponse,
} from "./types";

export class StructuredResponseTool {
    private readonly maxSmallContextChars = 80000;

    constructor(private readonly env: Env) {
        if (!env?.AI) {
            throw new Error("Cloudflare AI binding (env.AI) is required for StructuredResponseTool.");
        }
    }

    private fillMissingFields<T extends ZodObject<any>>(schema: T, aiResponse: any): z.infer<T> {
        const fullResponse: any = { ...aiResponse };
        const properties = schema.shape as Record<string, ZodSchema<any>>;

        for (const key in properties) {
            if (!(key in fullResponse) || fullResponse[key] === undefined) {
                const zodType = properties[key];

                switch (zodType._def?.typeName) {
                    case "ZodArray":
                        fullResponse[key] = [];
                        break;
                    case "ZodObject":
                        fullResponse[key] = {};
                        break;
                    case "ZodString":
                        fullResponse[key] = "";
                        break;
                    case "ZodNumber":
                        fullResponse[key] = 0;
                        break;
                    case "ZodBoolean":
                        fullResponse[key] = false;
                        break;
                    default:
                        fullResponse[key] = null;
                }
            }
        }

        return schema.parse(fullResponse);
    }

    private async executeModel<T extends ZodObject<any>>(
        modelName: StructuredModel,
        textPayload: string,
        schema: T,
        isChunk: boolean = false,
    ): Promise<StructuredResponse<z.infer<T>>> {
        try {
            const prompt = `You are an AI assistant tasked with analyzing the following text and extracting information according to a specific JSON schema.\n--- TEXT START ---\n${textPayload}\n--- TEXT END ---\nYour response MUST be a single, valid JSON object that strictly adheres to the provided JSON schema. Do not include any explanatory text, markdown formatting, or anything else outside the JSON object itself. Respond with the JSON for the text provided above.`;

            const jsonSchema = zodToJsonSchema(schema, { $refStrategy: "none", errorMessages: true });

            if (jsonSchema && typeof jsonSchema === "object" && "$schema" in jsonSchema) {
                delete (jsonSchema as any).$schema;
            }

            if (
                !jsonSchema ||
                typeof jsonSchema !== "object" ||
                !("properties" in jsonSchema) ||
                !("type" in jsonSchema) ||
                (jsonSchema as any).type !== "object"
            ) {
                throw new Error("Failed to generate a valid JSON schema for the request.");
            }

            const response = await this.env.AI.run(modelName, {
                messages: [
                    {
                        role: "system",
                        content: "You are an AI assistant specialized in extracting structured data from text into a specified JSON format.",
                    },
                    {
                        role: "user",
                        content: prompt,
                    },
                ],
                response_format: {
                    type: "json_schema",
                    json_schema: jsonSchema,
                },
            });

            const resultObject = response?.response;

            if (resultObject === undefined || resultObject === null) {
                throw new Error(`Model ${modelName} returned an empty or invalid response.`);
            }

            const validatedResponse = this.fillMissingFields(schema, resultObject);

            return {
                success: true,
                modelUsed: modelName,
                structuredResult: validatedResponse,
                isChunked: isChunk,
            };
        } catch (error: any) {
            return {
                success: false,
                modelUsed: modelName,
                structuredResult: null,
                error: `Model ${modelName} failed: ${error?.errors ? JSON.stringify(error.errors) : error?.message || String(error)}`,
                isChunked: isChunk,
            };
        }
    }

    private async chunkAndMerge<T extends ZodObject<any>>(
        modelName: typeof Llama4Scout | typeof MistralSmall3_1,
        fullText: string,
        schema: T,
    ): Promise<StructuredResponse<z.infer<T>>> {
        const chunkSize = this.maxSmallContextChars;
        const textChunks: string[] = [];

        for (let i = 0; i < fullText.length; i += chunkSize) {
            textChunks.push(fullText.substring(i, i + chunkSize));
        }

        const mergedResults: Record<string, any> = {};
        let firstSuccessfulModel: StructuredModel | null = null;

        for (let i = 0; i < textChunks.length; i++) {
            const result = await this.executeModel(modelName, textChunks[i], schema, true);

            if (!result.success || !result.structuredResult) {
                return {
                    success: false,
                    modelUsed: modelName,
                    structuredResult: null,
                    error: `Chunking failure on chunk ${i + 1}/${textChunks.length}: ${result.error}`,
                    isChunked: true,
                };
            }

            if (!firstSuccessfulModel) {
                firstSuccessfulModel = result.modelUsed;
            }

            const currentResult = result.structuredResult;

            for (const key in currentResult) {
                const newValue = currentResult[key as keyof typeof currentResult];
                const existingValue = mergedResults[key];

                if (Array.isArray(newValue)) {
                    mergedResults[key] = Array.isArray(existingValue)
                        ? [...existingValue, ...newValue]
                        : [...newValue];
                } else if (
                    newValue !== null &&
                    typeof newValue === "object" &&
                    !Array.isArray(newValue)
                ) {
                    mergedResults[key] =
                        existingValue !== null && typeof existingValue === "object" && !Array.isArray(existingValue)
                            ? { ...existingValue, ...newValue }
                            : { ...newValue };
                } else if (newValue !== null && newValue !== undefined) {
                    mergedResults[key] = newValue;
                } else if (!(key in mergedResults)) {
                    mergedResults[key] = newValue;
                }
            }
        }

        try {
            const validatedFinal = this.fillMissingFields(schema, mergedResults);
            return {
                success: true,
                modelUsed: firstSuccessfulModel || modelName,
                structuredResult: validatedFinal,
                isChunked: true,
            };
        } catch (error: any) {
            return {
                success: false,
                modelUsed: firstSuccessfulModel || modelName,
                structuredResult: null,
                error: `Final validation after merging failed: ${
                    error?.errors ? JSON.stringify(error.errors) : error?.message || String(error)
                }`,
                isChunked: true,
            };
        }
    }

    public async analyzeText<T extends ZodObject<any>>(
        schema: T,
        textPayload: string,
    ): Promise<StructuredResponse<z.infer<T>>> {
        if (!textPayload) {
            throw new Error("Input textPayload cannot be empty for analyzeText.");
        }

        if (textPayload.length > this.maxSmallContextChars) {
            let result = await this.executeModel(Llama4Scout, textPayload, schema);
            if (result.success) return result;

            result = await this.executeModel(MistralSmall3_1, textPayload, schema);
            if (result.success) return result;

            return this.chunkAndMerge(Llama4Scout, textPayload, schema);
        }

        let result = await this.executeModel(Hermes2Pro, textPayload, schema);
        if (result.success) return result;

        result = await this.executeModel(MistralSmall3_1, textPayload, schema);
        if (result.success) return result;

        result = await this.executeModel(Llama4Scout, textPayload, schema);
        if (result.success) return result;

        result = await this.executeModel(Llama3_3, textPayload, schema);
        if (result.success) return result;

        return {
            success: false,
            modelUsed: Llama3_3,
            structuredResult: null,
            error: `All models (${Hermes2Pro}, ${MistralSmall3_1}, ${Llama4Scout}, ${Llama3_3}) failed to generate a valid structured response. Last error: ${result.error}`,
        };
    }

    public async analyzeTextWithModel<T extends ZodObject<any>>(
        schema: T,
        textPayload: string,
        modelName: StructuredModel,
    ): Promise<StructuredResponse<z.infer<T>>> {
        if (!textPayload) {
            throw new Error("Input textPayload cannot be empty for analyzeTextWithModel.");
        }

        return this.executeModel(modelName, textPayload, schema);
    }

    public async requestBatchAnalysis<T extends ZodObject<any>>(
        modelName: StructuredModel,
        textPayloads: string[],
        schema: T,
        externalReferences?: string[],
    ): Promise<BatchQueuedResponse> {
        if (!textPayloads?.length) {
            throw new Error("At least one text payload is required for batch analysis.");
        }

        if (textPayloads.some((text) => !text)) {
            throw new Error("All text payloads in the batch must be non-empty.");
        }

        if (externalReferences && externalReferences.length !== textPayloads.length) {
            throw new Error("Length of externalReferences must match the length of textPayloads.");
        }

        const jsonSchema = zodToJsonSchema(schema, { $refStrategy: "none", errorMessages: true });
        if (jsonSchema && typeof jsonSchema === "object" && "$schema" in jsonSchema) {
            delete (jsonSchema as any).$schema;
        }

        if (
            !jsonSchema ||
            typeof jsonSchema !== "object" ||
            !("properties" in jsonSchema) ||
            !("type" in jsonSchema) ||
            (jsonSchema as any).type !== "object"
        ) {
            throw new Error("Failed to generate a valid JSON schema for the batch request.");
        }

        const commonResponseFormat = {
            type: "json_schema" as const,
            json_schema: jsonSchema,
        };

        const requests = textPayloads.map((text, index) => ({
            messages: [
                {
                    role: "system" as const,
                    content: "You are an AI assistant specialized in extracting structured data from text into a specified JSON format.",
                },
                {
                    role: "user" as const,
                    content: `You are an AI assistant tasked with analyzing the following text and extracting information according to a specific JSON schema.\n--- TEXT START ---\n${text}\n--- TEXT END ---\nYour response MUST be a single, valid JSON object that strictly adheres to the provided JSON schema. Do not include any explanatory text, markdown formatting, or anything else outside the JSON object itself. Respond with the JSON for the text provided above.`,
                },
            ],
            response_format: commonResponseFormat,
            ...(externalReferences && { external_reference: externalReferences[index] }),
        }));

        const response: BatchQueuedResponse | any = await this.env.AI.run(
            modelName,
            { requests },
            { queueRequest: true },
        );

        if (response?.status !== "queued" || !response?.request_id) {
            throw new Error(`Failed to queue batch analysis request. Received status: ${response?.status}`);
        }

        return response;
    }

    public async pollBatchAnalysisStatus<T extends ZodObject<any>>(
        modelName: StructuredModel,
        requestId: string,
        schema: T,
    ): Promise<BatchStructuredPollResponse<z.infer<T> | { error: string }>> {
        if (!requestId) {
            throw new Error("Request ID is required to poll batch status.");
        }

        const response: BatchStructuredResult<any> | { status: "queued" | "running"; request_id: string; model: string } =
            await this.env.AI.run(modelName, {
                request_id: requestId,
            });

        if (response.status !== "completed") {
            return response as BatchStructuredPollResponse<z.infer<T>>;
        }

        if (!Array.isArray(response.responses)) {
            throw new Error(`Completed batch analysis response for ${requestId} has invalid structure.`);
        }

        const processedResponses: BatchStructuredResultItem<z.infer<T> | { error: string }>[] = await Promise.all(
            response.responses.map(async (item) => {
                if (item.success && item.result?.response) {
                    try {
                        const filled = this.fillMissingFields(schema, item.result.response);
                        return {
                            ...item,
                            result: { response: filled },
                        };
                    } catch (validationError: any) {
                        const errorMessage = `Schema validation failed: ${
                            validationError?.errors
                                ? JSON.stringify(validationError.errors)
                                : validationError?.message || String(validationError)
                        }`;
                        return {
                            ...item,
                            success: false,
                            error: errorMessage,
                            result: { response: { error: errorMessage } },
                        };
                    }
                }

                const errorMessage = item.error || "AI processing failed or result structure invalid.";
                return {
                    ...item,
                    success: false,
                    error: errorMessage,
                    result: { response: { error: errorMessage } },
                };
            }),
        );

        return {
            ...response,
            responses: processedResponses,
            status: "completed",
        } as BatchStructuredResult<z.infer<T> | { error: string }>;
    }

    public getAvailableModels(): StructuredModel[] {
        return [Llama4Scout, MistralSmall3_1, Hermes2Pro, Llama3_3];
    }
}
