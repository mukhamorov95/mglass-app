// Ф4: одно место, где решается, какой моделью считать. Раньше версия писалась
// строкой в каждом роуте — при смене поколения половина контуров оставалась на
// старой модели. Меняем здесь — меняется везде.
//
// SMART   — рассуждение, деньги, тексты клиенту, разбор документов.
// FAST    — короткая классификация и однострочные сводки: дёшево и быстро.
// FLAGSHIP — самое сложное: диалог с клиентом, финансовый советник владельца.

export const AI_MODELS = {
  flagship: 'claude-opus-4-8',
  smart: 'claude-sonnet-5',
  fast: 'claude-haiku-4-5-20251001',
} as const

export type AiModelTier = keyof typeof AI_MODELS
export const aiModel = (tier: AiModelTier = 'smart') => AI_MODELS[tier]
