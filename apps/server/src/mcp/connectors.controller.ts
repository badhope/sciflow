import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { ConnectorsService, type ConnectorKey } from './connectors.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

export class ConnectRequest {
  @ApiProperty() projectId!: string;
  @ApiProperty({ description: '凭据字段，按目录 fields 填写' }) config!: Record<string, string>;
}
export class ProjectBody { @ApiProperty() projectId!: string; }

@Controller('connectors')
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService, private readonly access: ProjectAccessService) {}

  @Get()
  list(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return { connectors: this.connectors.list(projectId) };
  }

  @Post('connect')
  connect(@Body() body: ConnectRequest & { key: ConnectorKey }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.connectors.connect(body.key, body.projectId, body.config || {});
  }

  @Post('disconnect')
  disconnect(@Body() body: ProjectBody & { key: ConnectorKey }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.connectors.disconnect(body.key, body.projectId);
  }

  @Post('test')
  test(@Body() body: ProjectBody & { key: ConnectorKey }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.connectors.test(body.key, body.projectId);
  }

  @Post('zotero/import')
  zoteroImport(@Body() body: ProjectBody & { limit?: number }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.connectors.importZotero(body.projectId, body.limit ?? 10);
  }

  @Post('feishu/notify')
  feishuNotify(@Body() body: ProjectBody & { text: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.connectors.feishuNotify(body.projectId, body.text || 'SciFlow 测试通知');
  }

  @Post('feishu/import-doc')
  feishuImport(@Body() body: ProjectBody & { documentId: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.connectors.feishuImportDoc(body.projectId, body.documentId);
  }

}
