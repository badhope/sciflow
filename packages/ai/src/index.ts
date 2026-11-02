/**
 * @sciflow/ai 公共出口（包边界）
 *
 * 接口层只应从这里 import；禁止深路径 `packages/ai/src/xxx`。
 * 由 ESLint 边界规则强制（eslint.config.mjs）。
 */
export * from './ai-transport.service';
export * from './ai.service';
export * from './model-catalog';
export * from './prompt-augmentation';
export * from './prompts';
export * from './mock-gateway';
