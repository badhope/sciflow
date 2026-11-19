import { ApiProperty } from '@nestjs/swagger';

/** 单日 Token 用量点。 */
export class TokenUsagePointDto {
  @ApiProperty({ description: '日期 YYYY-MM-DD' })
  date!: string;

  @ApiProperty({ description: 'token 数' })
  tokens!: number;

  @ApiProperty({ description: 'run 数' })
  runs!: number;
}

/** Token 用量走势响应。 */
export class AgentUsageTrendDto {
  @ApiProperty({ description: '按日用量', type: [TokenUsagePointDto] })
  trend!: TokenUsagePointDto[];
}
