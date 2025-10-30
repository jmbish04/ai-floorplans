import { zodToJsonSchema } from "zod-to-json-schema";

import {
    Hermes2Pro,
    Llama3_3,
    Llama4Scout,
    MistralSmall3_1,
} from "./models.js"; // Note the .js extension

export class StructuredResponseTool {
    maxSmallContextChars = 80000;

    constructor(env) {
        this.env = env; // Store the env
        if (!env?.AI) {
            throw new Error("Cloudflare AI binding (env.AI) is required for StructuredResponseTool.");
        }
    }

    /**
     * Fills in missing default fields for a Zod schema.
     * @param {object} schema - The Zod schema object
     * @param {object} aiResponse - The partial response from the AI
     * @returns {object} The full response with defaults filled
     */
    fillMissingFields(schema, aiResponse) {
        const fullResponse = { ...aiResponse };
        const properties = schema.shape; // Get the properties of the Zod object

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
        
        // Return the parsed (and validated) object
        return schema.parse(fullResponse);
    }

    /**
     * Executes a structured response query against a single model.
     * @param {string} modelName - The AI model to use
     * @param {string} textPayload - The full text prompt
     * @param {object} schema - The Zod schema for the response
     * @param {boolean} [isChunk=false] - Whether this is part of a chunked request
     * @returns {Promise<object>} A structured response object
     */
    async executeModel(
        modelName,
        textPayload,
        schema,
        isChunk = false,
    ) {
        try {
            const prompt = `You are an AI assistant tasked with analyzing the following text and extracting information according to a specific JSON schema.\n--- TEXT START ---\n${textPayload}\n--- TEXT END ---\nYour response MUST be a single, valid JSON object that strictly adheres to the provided JSON schema. Do not include any explanatory text, markdown formatting, or anything else outside the JSON object itself. Respond with the JSON for the text provided above.`;

            const jsonSchema = zodToJsonSchema(schema, { $refStrategy: "none", errorMessages: true });

            if (jsonSchema && typeof jsonSchema === "object" && "$schema" in jsonSchema) {
                delete jsonSchema.$schema;
            }

            if (
                !jsonSchema ||
                typeof jsonSchema !== "object" ||
                !("properties" in jsonSchema) ||
                !("type" in jsonSchema) ||
                jsonSchema.type !== "object"
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
        } catch (error) {
            const errorMessage = error?.errors ? JSON.stringify(error.errors) : error?.message || String(error);
            return {
                success: false,
                modelUsed: modelName,
                structuredResult: null,
                error: `Model ${modelName} failed: ${errorMessage}`,
                isChunked: isChunk,
            };
        }
    }

    /**
     * Chunks a large text payload and merges the structured results.
     * @param {string} modelName - The AI model to use
     * @param {string} fullText - The full text prompt
     * @param {object} schema - The Zod schema for the response
     * @returns {Promise<object>} A single merged structured response
     */
    async chunkAndMerge(
        modelName,
        fullText,
        schema,
    ) {
        const chunkSize = this.maxSmallContextChars;
        const textChunks = [];

        for (let i = 0; i < fullText.length; i += chunkSize) {
            textChunks.push(fullText.substring(i, i + chunkSize));
        }

        const mergedResults = {};
        let firstSuccessfulModel = null;

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
                const newValue = currentResult[key];
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
                        (existingValue !== null && typeof existingValue === "object" && !Array.isArray(existingValue))
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
        } catch (error) {
             const errorMessage = error?.errors ? JSON.stringify(error.errors) : error?.message || String(error);
            return {
                success: false,
                modelUsed: firstSuccessfulModel || modelName,
                structuredResult: null,
                error: `Final validation after merging failed: ${errorMessage}`,
                isChunked: true,
            };
        }
    }

    /**
     * Analyzes text and returns a structured response, trying multiple models.
     * @param {object} schema - The Zod schema for the response
     * @param {string} textPayload - The full text prompt
     * @returns {Promise<object>} A structured response object
     */
    async analyzeText(
        schema,
        textPayload,
    ) {
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

    /**
     * Analyzes text with a specific model.
     * @param {object} schema - The Zod schema for the response
     * @param {string} textPayload - The full text prompt
     * @param {string} modelName - The AI model to use
     * @returns {Promise<object>} A structured response object
     */
    async analyzeTextWithModel(
        schema,
        textPayload,
        modelName,
    ) {
        if (!textPayload) {
            throw new Error("Input textPayload cannot be empty for analyzeTextWithModel.");
        }

        return this.executeModel(modelName, textPayload, schema);
    }

    /**
     * Queues a batch analysis request.
     * @param {string} modelName - The AI model to use
     * @param {string[]} textPayloads - An array of text prompts
     * @param {object} schema - The Zod schema for the responses
     * @param {string[]} [externalReferences] - Optional array of external IDs
     * @returns {Promise<object>} The batch queue response
     */
    async requestBatchAnalysis(
        modelName,
        textPayloads,
        schema,
        externalReferences,
    ) {
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
            delete jsonSchema.$schema;
        }

        if (
            !jsonSchema ||
            typeof jsonSchema !== "object" ||
            !("properties" in jsonSchema) ||
            !("type" in jsonSchema) ||
            jsonSchema.type !== "object"
        ) {
            throw new Error("Failed to generate a valid JSON schema for the batch request.");
        }

        const commonResponseFormat = {
            type: "json_schema",
            json_schema: jsonSchema,
        };

        const requests = textPayloads.map((text, index) => ({
            messages: [
                {
                    role: "system",
                    content: "You are an AI assistant specialized in extracting structured data from text into a specified JSON format.",
                },
                {
                    role: "user",
                    content: `You are an AI assistant tasked with analyzing the following text and extracting information according to a specific JSON schema.\n--- TEXT START ---\n${text}\n--- TEXT END ---\nYour response MUST be a single, valid JSON object that strictly adheres to the provided JSON schema. Do not include any explanatory text, markdown formatting, or anything else outside the JSON object itself. Respond with the JSON for the text provided above.`,
                },
            ],
            response_format: commonResponseFormat,
            ...(externalReferences && { external_reference: externalReferences[index] }),
        }));

        const response = await this.env.AI.run(
            modelName,
            { requests },
            { queueRequest: true },
        );

        if (response?.status !== "queued" || !response?.request_id) {
            throw new Error(`Failed to queue batch analysis request. Received status: ${response?.status}`);
        }

        return response;
    }

    /**
     * Polls the status of a batch analysis request.
     * @param {string} modelName - The AI model used for the batch
     * @param {string} requestId - The request ID from requestBatchAnalysis
     * @param {object} schema - The Zod schema for validation
     * @returns {Promise<object>} The batch status or results
     */
    async pollBatchAnalysisStatus(
        modelName,
        requestId,
        schema,
    ) {
        if (!requestId) {
            throw new Error("Request ID is required to poll batch status.");
        }

        const response = await this.env.AI.run(modelName, {
            request_id: requestId,
        });

        if (response.status !== "completed") {
            return response;
        }

        if (!Array.isArray(response.responses)) {
            throw new Error(`Completed batch analysis response for ${requestId} has invalid structure.`);
        }

        const processedResponses = await Promise.all(
            response.responses.map(async (item) => {
                if (item.success && item.result?.response) {
                    try {
                        const filled = this.fillMissingFields(schema, item.result.response);
                        return {
                            ...item,
                            result: { response: filled },
                        };
                    } catch (validationError) {
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
        };
    }

    /**
     * @returns {string[]} A list of available structured models
     */
    getAvailableModels() {
        return [Llama4Scout, MistralSmall3_1, Hermes2Pro, Llama3_3];
    }
}
