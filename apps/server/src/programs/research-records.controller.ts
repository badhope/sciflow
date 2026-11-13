import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ResearchRecordsService } from './research-records.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

/**
 * 研究记录 API（阶段 2B）：Claim / Evidence / Run。
 * 所有端点都经项目归属校验；本地模式保持零登录体验。
 */
@Controller('programs')
export class ResearchRecordsController {
  constructor(
    private readonly records: ResearchRecordsService,
    private readonly access: ProjectAccessService,
  ) {}

  // ---------- Claim ----------

  @Get(':id/claims')
  listClaims(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertResearchProgram(id, req.user);
    return this.records.listClaims(id);
  }

  @Post(':id/claims')
  createClaim(
    @Param('id') id: string,
    @Body() body: { statement: string; cycleId?: string; protocolId?: string; confidence?: number; status?: string; scope?: string },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertResearchProgram(id, req.user);
    return this.records.createClaim(id, body, req.user?.sub || '');
  }

  @Get('claims/:claimId')
  getClaim(@Param('claimId') claimId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertResearchClaim(claimId, req.user);
    return this.records.getClaim(claimId);
  }

  @Patch('claims/:claimId')
  updateClaim(
    @Param('claimId') claimId: string,
    @Body() body: { statement?: string; confidence?: number; status?: string; scope?: string },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertResearchClaim(claimId, req.user);
    return this.records.updateClaim(claimId, body);
  }

  // ---------- Evidence ----------

  @Get('claims/:claimId/evidence')
  listEvidence(@Param('claimId') claimId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertResearchClaim(claimId, req.user);
    return this.records.listEvidence(claimId);
  }

  @Post('claims/:claimId/evidence')
  addEvidence(
    @Param('claimId') claimId: string,
    @Body() body: { sourceType: string; sourceId?: string; quote?: string; stance?: string; strength?: number; verified?: boolean },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertResearchClaim(claimId, req.user);
    return this.records.addEvidence(claimId, body, req.user?.sub || '');
  }

  @Post('evidence/:evidenceId/verify')
  verifyEvidence(
    @Param('evidenceId') evidenceId: string,
    @Body() body: { verified: boolean },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertResearchEvidence(evidenceId, req.user);
    return this.records.verifyEvidence(evidenceId, body?.verified === true);
  }

  // ---------- Run ----------

  @Get(':id/runs')
  listRuns(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertResearchProgram(id, req.user);
    return this.records.listRuns(id);
  }

  @Post(':id/runs')
  createRun(
    @Param('id') id: string,
    @Body() body: { cycleId?: string; protocolId?: string; experimentId?: string; status?: string; manifest?: unknown; summary?: string; startedAt?: number; endedAt?: number },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertResearchProgram(id, req.user);
    return this.records.createRun(id, body);
  }

  @Get('runs/:runId')
  getRun(@Param('runId') runId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertResearchRun(runId, req.user);
    return this.records.getRun(runId);
  }

  @Patch('runs/:runId')
  updateRun(
    @Param('runId') runId: string,
    @Body() body: { status?: string; manifest?: unknown; summary?: string; experimentId?: string; startedAt?: number; endedAt?: number },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertResearchRun(runId, req.user);
    return this.records.updateRun(runId, body);
  }
}
