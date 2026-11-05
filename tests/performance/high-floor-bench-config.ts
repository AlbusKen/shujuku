/**
 * 高楼层基准（H3）共用开关：默认关闭，避免进入默认 vitest run。
 *
 * 开启：$env:ACU_HIGH_FLOOR_BENCH='1'
 * 覆盖规模：$env:ACU_HIGH_FLOOR_BENCH_SIZES='1000,3000'（正整数，逗号分隔）
 */

export const HIGH_FLOOR_BENCH_ENABLED_ACU = process.env.ACU_HIGH_FLOOR_BENCH === '1';

export const HIGH_FLOOR_BENCH_TIMEOUT_MS_ACU = 30 * 60_000;

const DEFAULT_HIGH_FLOOR_BENCH_SIZES_ACU = [1000, 3000, 5000];

export function resolveHighFloorBenchSizes_ACU(raw: string | undefined = process.env.ACU_HIGH_FLOOR_BENCH_SIZES): number[] {
  if (raw === undefined || raw.trim() === '') return [...DEFAULT_HIGH_FLOOR_BENCH_SIZES_ACU];
  const sizes = raw.split(',').map(part => Number(part.trim()));
  if (sizes.some(size => !Number.isInteger(size) || size <= 0)) {
    throw new Error(`ACU_HIGH_FLOOR_BENCH_SIZES 非法：${raw}`);
  }
  return sizes;
}
