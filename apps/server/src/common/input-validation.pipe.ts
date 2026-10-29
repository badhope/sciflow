import { PipeTransform, Injectable, ArgumentMetadata, BadRequestException } from '@nestjs/common';

/**
 * 轻量全局输入校验（零新增依赖兜底）：
 * 项目未安装 class-validator/class-transformer，且全部控制器 body 为内联对象类型
 * （运行时 metatype 为 Object，Nest ValidationPipe 即便安装也不会真正剥字段）。
 * 因此这里只做不破坏现有端点的基本安全约束：
 *  - 仅作用于 @Body() 负载（param/query 原样放行）；
 *  - body 为 undefined/null 时放行（兼容可选 body 的端点）；
 *  - 声明为对象 body 时拒绝数组（防 JSON 数组被当成对象后取字段全 undefined）。
 * 不做白名单剥字段——内联类型无运行时字段白名单，剥字段只会误伤合法请求。
 *
 * 历史缺陷（v1.9.1 修复）：此前对标量也抛 400，而 Nest 的 `@Body('field')` 逐字段取参
 * 会让管道收到 string/number —— `references/gap`（研究缺口）因此**全量不可用**：
 * 前端按钮永远收到「请求体必须是 JSON 对象」，而回归脚本没覆盖该路由，缺陷藏了两个版本。
 * 现在标量值放行（那是 `@Body('x')` 的合法语义），只拦数组。
 */
@Injectable()
export class InputValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type !== 'body') return value;
    if (value === undefined || value === null) return value;
    // 标量来自 @Body('x') 逐字段取参，按 Nest 语义原样放行
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      throw new BadRequestException('请求体必须是 JSON 对象');
    }
    return value;
  }
}
