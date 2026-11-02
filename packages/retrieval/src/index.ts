/**
 * @sciflow/retrieval 公共出口（包边界）
 *
 * 接口层只应从这里 import；禁止深路径 `packages/retrieval/src/xxx`。
 */
export * from './knowledge.service';
export { EMBEDDING_DIM, REMOTE_EMBEDDER, resolveEmbeddingBackend, toVectorBlob } from './embedding.service';
export type { EmbeddingBackend, RemoteEmbedder } from './embedding.service';
export { EmbeddingService } from './embedding.service';
export { mmrSelect, normalizeScores } from './mmr';
export type { MmrCandidate, MmrOptions } from './mmr';
export { projectTo2D, blobToVector, downsampleIndices } from './projection';
