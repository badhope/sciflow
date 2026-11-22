import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 一个可用的远程访问入口（不含一次性配对 token）。 */
export class RemoteAccessAddressDto {
  @ApiProperty({ description: '入口类型：public / lan / localhost' })
  kind!: 'public' | 'lan' | 'localhost';

  @ApiProperty({ description: '给用户看的名称，如「局域网 · 192.168.1.8」' })
  label!: string;

  @ApiProperty({ description: '入口根地址（不含 token）' })
  url!: string;

  @ApiPropertyOptional({ description: '含一次性 token 的完整链接（仅在等待扫码时返回）' })
  link?: string;
}

export class RemoteAccessStatusDto {
  @ApiProperty({ description: '远程控制网关是否已启动' })
  active!: boolean;

  @ApiProperty({ description: '当前状态', enum: ['stopped', 'waiting', 'paired', 'expired'] })
  state!: 'stopped' | 'waiting' | 'paired' | 'expired';

  @ApiPropertyOptional({ description: '手机扫码/打开链接用的完整地址（含一次性 token，仅在 waiting 时返回）' })
  link?: string;

  @ApiPropertyOptional({ description: '链接对应的二维码 SVG（仅在 waiting 时返回，可直接内嵌渲染）' })
  qrSvg?: string;

  @ApiPropertyOptional({ description: '配对 token 或手机访问会话的过期时间（ISO 8601）' })
  expiresAt?: string;

  @ApiPropertyOptional({ description: '网关启动时间（ISO 8601）' })
  startedAt?: string;

  @ApiPropertyOptional({ description: '手机完成配对的时间（ISO 8601）' })
  pairedAt?: string;

  @ApiPropertyOptional({ description: '手机最近一次请求时间（ISO 8601）' })
  lastSeenAt?: string;

  @ApiPropertyOptional({ description: '已连接设备描述，如「Android · Chrome」' })
  deviceLabel?: string;

  @ApiProperty({ description: '手机在最近 90 秒内是否仍有请求（用于展示在线状态）' })
  connected!: boolean;

  @ApiPropertyOptional({ description: '网关监听端口（用于排障）' })
  gatewayPort?: number;

  @ApiProperty({ type: [RemoteAccessAddressDto], description: '所有可用入口；二维码优先使用公网，其次局域网' })
  addresses!: RemoteAccessAddressDto[];

  @ApiProperty({ description: '是否通过 SCIFLOW_REMOTE_PUBLIC_URL 配置了公网/反代入口' })
  publicUrlConfigured!: boolean;

  @ApiPropertyOptional({ description: '需要用户处理的提示，如未检测到局域网地址' })
  hint?: string;
}

export class RemoteAccessSessionDto {
  @ApiProperty({ description: '配对是否成功' })
  ok!: boolean;

  @ApiPropertyOptional({ description: '失败原因（机器可读）' })
  reason?: 'invalid-token' | 'token-used' | 'expired' | 'already-paired';

  @ApiPropertyOptional({ description: '给手机端展示的失败说明' })
  message?: string;
}
