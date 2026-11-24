/**
 * 研究循环的确定性实验脚本（单一来源）。
 *
 * 用途有两处：
 *  1. AI_MOCK=1 的 mock 网关：让全自动科研循环能真正走通「协议→执行→评审→终止」；
 *  2. 真实模型连续空响应时的服务端兜底：保证循环不会因网关抖动变成空转。
 *
 * 约束：只用标准库、固定种子、必须 print 可核对的统计量。
 */
export const MOCK_EXPERIMENT_CODE = [
  'import random, math',
  'random.seed(42)',
  'n = 1200',
  'errors, variances = [], []',
  'for _ in range(n):',
  '    base = random.gauss(0.0, 1.0)',
  '    variances.append(max(abs(base) + random.gauss(0.15, 0.05), 0.01))',
  '    errors.append(abs(base) * 1.8 + random.gauss(0.4, 0.2))',
  'mean_e = sum(errors) / n',
  'mean_v = sum(variances) / n',
  'cov = sum((errors[i]-mean_e)*(variances[i]-mean_v) for i in range(n)) / n',
  'sd_e = math.sqrt(sum((x-mean_e)**2 for x in errors)/n)',
  'sd_v = math.sqrt(sum((x-mean_v)**2 for x in variances)/n)',
  'rho = cov / (sd_e * sd_v) if sd_e and sd_v else 0.0',
  'high = sorted(range(n), key=lambda i: errors[i], reverse=True)[:int(n*0.2)]',
  'low = [i for i in range(n) if i not in set(high)]',
  'auroc = sum(1 for i in high for j in low if variances[i] > variances[j]) / (len(high)*len(low))',
  'print("n=", n)',
  'print("mean_abs_error=", round(mean_e, 4))',
  'print("mean_uncertainty=", round(mean_v, 4))',
  'print("spearman_rho=", round(rho, 4))',
  'print("auroc=", round(auroc, 4))',
].join('\n');
