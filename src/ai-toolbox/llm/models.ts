export const Llama4Scout = "@cf/meta/llama-4-scout-17b-16e-instruct" as const;
export const MistralSmall3_1 = "@cf/mistralai/mistral-small-3.1-24b-instruct" as const;
export const Hermes2Pro = "@hf/nousresearch/hermes-2-pro-mistral-7b" as const;
export const Llama3_3 = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

export type StructuredModel =
    | typeof Llama4Scout
    | typeof MistralSmall3_1
    | typeof Hermes2Pro
    | typeof Llama3_3;

export const EmbedModel = "@cf/baai/bge-large-en-v1.5" as const;
export const RerankerModel = "@cf/baai/bge-reranker-base" as const;
