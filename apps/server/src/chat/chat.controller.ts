import { Controller, Post, Body, Res, Req, Get, Query, Param, Patch, Put, Delete, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Response, Request } from 'express';
import { ChatService } from './chat.service';
import { ChatSessionService, type StoredChatMessage, type ChatSessionBranchState } from './chat-session.service';
import { BackgroundRunService } from './background-run.service';
import { ChatMessage } from '../ai/ai.service';
import { forwardOpenAiSse } from '../common/sse.helper';
import { ConfigCenterService } from '../config/config-center.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

export class BackgroundJobRequest {
  @ApiProperty({ description: '项目 ID' })
  projectId!: string;
  @ApiProperty({ description: '后台任务的用户消息' })
  message!: string;
  @ApiPropertyOptional({ description: '会话键；同一键串行，不同键可并行', default: 'default' })
  sessionKey?: string;
  @ApiPropertyOptional({ description: '显式模型 ID' })
  model?: string;
}

export class ChatAttachmentDto {
  @ApiProperty({ description: '文件名' })
  name!: string;
  @ApiProperty({ description: 'MIME 类型，如 application/pdf、image/png' })
  mime!: string;
  @ApiProperty({ description: 'base64 内容（不含 data: 前缀）' })
  data!: string;
}

export class ChatRequestBody {
  @ApiProperty({ description: '本轮用户提问', example: '图神经网络的消息传递机制是什么？' })
  message!: string;

  @ApiPropertyOptional({ description: '本轮附件（PDF/文本/CSV/图片，最多 4 个）', type: [ChatAttachmentDto] })
  attachments?: ChatAttachmentDto[];

  @ApiPropertyOptional({ description: '历史消息（role/content）', type: 'array', items: { type: 'object' } })
  history?: ChatMessage[];

  @ApiPropertyOptional({ description: '项目 ID：用于知识库 RAG 与项目记忆检索' })
  projectId?: string;

  @ApiPropertyOptional({ description: '关联文档上下文（标题+大纲+正文片段）' })
  docContext?: string;
  @ApiPropertyOptional({ description: '显式指定模型 ID（best-effort 覆盖默认模型）' })
  model?: string;
  @ApiPropertyOptional({ description: '开启推理过程透传（delta.reasoning_content / delta.thinking）' })
  enableThinking?: boolean;
  @ApiPropertyOptional({ description: '本轮强制联网搜索（输入区「联网」开关，按轮生效）' })
  webSearch?: boolean;

  @ApiPropertyOptional({ description: '当前会话 ID：用于把完整消息同步到 chat_session' })
  sessionId?: string;
  @ApiPropertyOptional({ description: '当前会话标题（首轮可空，服务端会从首条用户消息派生）' })
  sessionTitle?: string;
}

export class CreateChatSessionBody {
  @ApiProperty({ description: '项目 ID' })
  projectId!: string;
  @ApiPropertyOptional({ description: '会话 ID；前端 localStorage 迁移时传入，保证幂等' })
  id?: string;
  @ApiPropertyOptional({ description: '会话标题' })
  title?: string;
  @ApiPropertyOptional({ description: '完整消息数组（StoredChatMessage[]）', type: 'array', items: { type: 'object' } })
  messages?: StoredChatMessage[];
  @ApiPropertyOptional({ description: '分支状态（activeLeafId 等）', type: 'object', additionalProperties: true })
  branch?: ChatSessionBranchState;
  @ApiPropertyOptional({ description: '摘要（仅导入旧会话时使用）' })
  summary?: string;
}

export class SaveChatSessionBody {
  @ApiPropertyOptional({ description: '会话标题' })
  title?: string;
  @ApiPropertyOptional({ description: '完整消息数组（StoredChatMessage[]）', type: 'array', items: { type: 'object' } })
  messages?: StoredChatMessage[];
  @ApiPropertyOptional({ description: '分支状态（activeLeafId 等）', type: 'object', additionalProperties: true })
  branch?: ChatSessionBranchState;
  @ApiPropertyOptional({ description: '摘要（可选；常规同步不要覆盖服务端摘要）' })
  summary?: string;
}

export class PatchChatSessionBody {
  @ApiPropertyOptional({ description: '会话标题' })
  title?: string;
  @ApiPropertyOptional({ description: '置顶' })
  pinned?: boolean;
  @ApiPropertyOptional({ description: '归档' })
  archived?: boolean;
  @ApiPropertyOptional({ description: '摘要' })
  summary?: string;
}

/**
 * SSE 事件契约（向后兼容升级）：
 *  - `data: {"sources":[{docName,score,chunkText,chunkSeq,referenceId,referenceTitle}]}`   正文开始前一次（无命中则不发）
 *      · docName/score 为旧字段，保持不变；chunkText/chunkSeq/referenceId/referenceTitle 为本轮新增附加字段，
 *        与 knowledge query 的 sources 对齐。referenceId/referenceTitle 未绑定文献时为 null。旧客户端只读 docName/score，不受影响。
 *      · chunkText 截断到 ≤2000 字符，超限末尾追加 `…[已截断]`，未超限原样；字段名/长度变化不影响旧客户端。
 *        完整块可凭 chunkSeq 经 GET /api/knowledge/:id 取全文。
 *  - `data: {"delta":"..."}`                  正文增量（旧客户端兼容）
 *  - `data: {"delta":"...","reasoning":"..."}` 正文+推理过程同发（reasoning 仅在「深度思考」开启且上游有值时附加；
 *      对无视 thinking 参数、恒输出 reasoning_content 的推理型网关，关闭开关时此处不再下发 reasoning，保持折叠思维链 UI 静默）
 *  - `data: {"usage":{prompt_tokens,completion_tokens,total_tokens}}` 收尾一次
 *  - `data: {"error":"..."}`                  异常
 *  - `data: [DONE]`                           结束
 */
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly chatSession: ChatSessionService,
    private readonly config: ConfigCenterService,
    private readonly access: ProjectAccessService,
    private readonly background: BackgroundRunService,
  ) {}

  @Post()
  async answer(@Body() body: ChatRequestBody, @Req() req: { user?: AuthPayload }) {
    // v1.8：带 projectId 时必须校验归属 —— 否则企业模式可用他人项目上下文做 RAG 问答
    if (body.projectId) this.access.assertProject(body.projectId, req.user);
    return this.chat.answer(body.message, body.history || [], body.projectId, body.docContext, {
      model: body.model,
      user: req.user,
      attachments: body.attachments,
    });
  }

  /** 后台执行：立即入队返回 202，真正的模型/工具循环在服务端继续跑 */
  @Post('background')
  @HttpCode(HttpStatus.ACCEPTED)
  startBackground(@Body() body: BackgroundJobRequest, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.background.start(body);
  }

  /** 后台任务列表（按项目；默认最新 20 条） */
  @Get('background')
  listBackground(@Query('projectId') projectId: string, @Query('limit') limit: string | undefined, @Req() req: { user?: AuthPayload }) {
    if (!projectId) return { error: 'projectId required', jobs: [] };
    this.access.assertProject(projectId, req.user);
    return { jobs: this.background.list(projectId, Number(limit) || 20) };
  }

  /** 后台任务详情（含已完成的完整输出） */
  @Get('background/:id')
  getBackground(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    const job = this.background.get(id);
    this.access.assertProject(job.projectId, req.user);
    return job;
  }

  /** 取消后台任务：排队中直接标记取消，运行中尽力中止上游 */
  @Post('background/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelBackground(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    const job = this.background.get(id);
    this.access.assertProject(job.projectId, req.user);
    return this.background.cancel(id);
  }

  /** SSE 流式问答 */
  @Post('stream')
  async stream(@Body() body: ChatRequestBody, @Res() res: Response, @Req() req: Request & { user?: AuthPayload }) {
    // v1.8：流式入口同样校验项目归属（SSE 里抛错会断流，因此先校验再写头）
    if (body.projectId) {
      try {
        this.access.assertProject(body.projectId, req.user);
      } catch (e: any) {
        res.status(404).json({ error: e?.message || '项目不存在' });
        return;
      }
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // 前端停止流式时客户端断开 → 中止上游 fetch，避免生成空跑浪费 token（尽力而为）
    const ac = new AbortController();
    let closed = false;
    req.on('close', () => {
      closed = true;
      try { ac.abort(); } catch { /* noop */ }
    });

    // 深度思考开关：仅显式开启时才把上游推理增量（delta.reasoning_content / delta.thinking）透传给前端。
    const forwardReasoning = body.enableThinking === true;
    // 当前轮完整消息 = 历史 + 本轮用户输入 + LLM 回复（onComplete 里组入）
    const historyMsgs: ChatMessage[] = body.history ? [...body.history] : [];
    if (body.message?.trim()) historyMsgs.push({ role: 'user', content: body.message });
    try {
      const { stream, sources } = await this.chat.stream(
        body.message, body.history || [], body.projectId, body.docContext,
        { model: body.model, enableThinking: body.enableThinking, signal: ac.signal, webSearch: body.webSearch, user: req.user, attachments: body.attachments },
      );
      // 正文流开始前先推送 RAG 来源（无命中则不发送）
      if (sources.length && !closed) {
        res.write(`data: ${JSON.stringify({ sources })}\n\n`);
      }
      const result = await forwardOpenAiSse(res, {
        stream,
        forwardReasoning,
        signal: ac.signal,
        // 流完整结束后异步记录本轮会话摘要（fire-and-forget，不阻塞 SSE 收尾）
        onComplete: (fullText, tokens) => {
          if (body.projectId && fullText) {
            const msgs: ChatMessage[] = [...historyMsgs, { role: 'assistant', content: fullText }];
            this.chat.recordSessionSummary(body.projectId, msgs, tokens, body.sessionId, body.sessionTitle);
          }
          // chat:after 钩子（webhook 类；prompt_inject 类已在 system 层生效）
          if (fullText) void this.config.runEventHooks('chat:after', { text: body.message, answer: fullText.slice(0, 2000), projectId: body.projectId, tokens }, 'chat');
        },
      });
      if (result.error && !closed) {
        res.write(`data: ${JSON.stringify({ error: result.error })}\n\n`);
      }
    } catch (e: any) {
      if (!closed) res.write(`data: ${JSON.stringify({ error: e?.message || String(e) })}\n\n`);
    }
    res.end();
  }

  /** GET /api/chat/sessions?projectId=... — 项目会话列表（标题/摘要/置顶/归档/全文搜索） */
  @Get('sessions')
  listSessions(
    @Query('projectId') projectId: string,
    @Query('q') q: string | undefined,
    @Query('includeArchived') includeArchived: string | undefined,
    @Req() req?: { user?: AuthPayload },
  ) {
    if (!projectId) throw new BadRequestException('projectId required');
    // v1.8：会话含提问首句和完整消息，必须按项目归属校验
    this.access.assertProject(projectId, req?.user);
    return {
      sessions: this.chatSession.listConversations(projectId, {
        q,
        includeArchived: includeArchived === '1' || includeArchived === 'true',
      }),
    };
  }

  /** GET /api/chat/sessions/:id?projectId=... — 打开完整会话 */
  @Get('sessions/:id')
  getSession(
    @Param('id') id: string,
    @Query('projectId') projectId: string,
    @Req() req?: { user?: AuthPayload },
  ) {
    if (!projectId) throw new BadRequestException('projectId required');
    this.access.assertProject(projectId, req?.user);
    return this.chatSession.getConversation(projectId, id);
  }

  /** POST /api/chat/sessions — 创建会话（可带本地 id，便于 localStorage 幂等迁移） */
  @Post('sessions')
  createSession(@Body() body: CreateChatSessionBody, @Req() req?: { user?: AuthPayload }) {
    if (!body.projectId) throw new BadRequestException('projectId required');
    this.access.assertProject(body.projectId, req?.user);
    return this.chatSession.createConversation(body.projectId, body);
  }

  /** PUT /api/chat/sessions/:id — 前端消息变更时同步完整会话 */
  @Put('sessions/:id')
  saveSession(
    @Param('id') id: string,
    @Body() body: SaveChatSessionBody,
    @Query('projectId') projectId: string,
    @Req() req?: { user?: AuthPayload },
  ) {
    if (!projectId) throw new BadRequestException('projectId required');
    this.access.assertProject(projectId, req?.user);
    return this.chatSession.saveConversation(projectId, id, body);
  }

  /** PATCH /api/chat/sessions/:id?projectId=... — 重命名/置顶/归档 */
  @Patch('sessions/:id')
  patchSession(
    @Param('id') id: string,
    @Body() body: PatchChatSessionBody,
    @Query('projectId') projectId: string,
    @Req() req?: { user?: AuthPayload },
  ) {
    if (!projectId) throw new BadRequestException('projectId required');
    this.access.assertProject(projectId, req?.user);
    return this.chatSession.patchConversation(projectId, id, body);
  }

  /** DELETE /api/chat/sessions/:id?projectId=... */
  @Delete('sessions/:id')
  deleteSession(
    @Param('id') id: string,
    @Query('projectId') projectId: string,
    @Req() req?: { user?: AuthPayload },
  ) {
    if (!projectId) throw new BadRequestException('projectId required');
    this.access.assertProject(projectId, req?.user);
    this.chatSession.deleteConversation(projectId, id);
    return { ok: true };
  }
}