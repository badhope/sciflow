import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CustomizationService } from './customization.service';

@Controller('customization')
export class CustomizationController {
  constructor(private readonly customization: CustomizationService) {}

  // 意图库
  @Get('intents')
  listIntents() {
    return this.customization.listIntents();
  }

  @Post('intents')
  createIntent(@Body() body: { key: string; label: string; route: string; keywords: string[] }) {
    return this.customization.createIntent(body);
  }

  @Post('intents/:id')
  updateIntent(@Param('id') id: string, @Body() body: { label?: string; route?: string; keywords?: string[]; enabled?: number }) {
    return this.customization.updateIntent(id, body);
  }

  @Delete('intents/:id')
  deleteIntent(@Param('id') id: string) {
    return this.customization.deleteIntent(id);
  }

  @Delete('intents')
  resetIntents() {
    return this.customization.resetIntents();
  }

  // 流水线步骤
  @Get('pipeline-steps')
  listPipelineSteps() {
    return this.customization.listPipelineSteps();
  }

  @Post('pipeline-steps/:stepKey')
  updatePipelineStep(@Param('stepKey') stepKey: string, @Body() body: { enabled: number }) {
    return this.customization.updatePipelineStep(stepKey, body.enabled);
  }

  @Delete('pipeline-steps')
  resetPipelineSteps() {
    return this.customization.resetPipelineSteps();
  }

  // 流水线运行参数（研究深度）
  @Get('pipeline-settings')
  getPipelineSettings() {
    return this.customization.getPipelineSettings();
  }

  @Post('pipeline-settings')
  setPipelineSettings(@Body() body: { researchDepth?: number }) {
    return this.customization.setPipelineSettings(body || {});
  }

  // 质量评分权重
  @Get('quality-weights')
  listQualityWeights() {
    return this.customization.listQualityWeights();
  }

  @Post('quality-weights')
  setQualityWeights(@Body() body: { weights: Record<string, number> }) {
    return this.customization.setQualityWeights(body.weights);
  }

  // 意图判断模式
  @Get('judgment-mode')
  getJudgmentMode() {
    return { mode: this.customization.getJudgmentMode() };
  }

  @Post('judgment-mode')
  setJudgmentMode(@Body() body: { mode: string }) {
    return this.customization.setJudgmentMode(body.mode);
  }

  // 提示词
  @Get('prompts')
  listPrompts() {
    return this.customization.listPrompts();
  }

  @Post('prompts/:toolKey')
  upsertPrompt(@Param('toolKey') toolKey: string, @Body() body: { prompt: string; enabled?: number }) {
    return this.customization.upsertPrompt(toolKey, body);
  }

  @Delete('prompts/:toolKey')
  deletePrompt(@Param('toolKey') toolKey: string) {
    return this.customization.deletePrompt(toolKey);
  }
}
