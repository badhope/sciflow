import { useMemo } from 'react';
import type { Project, DashboardOverview } from '../types';
import type { StageKey, StageState } from '../lib/stages';
import { deriveStages, stageOfView } from '../lib/stages';

export interface StageBarProps {
  project: Project;
  view: string;
  overview: DashboardOverview | null;
  docCount: number;
  hasContent: boolean;
  score: number | null;
  reviewedDocCount: number;
  submissionCount: number;
  onNavigate: (view: string) => void;
}

/**
 * 项目阶段条（常驻于工具栏下方）
 *
 * 产品叙事是「选题 → 文献 → 大纲 → 起草 → 评审 → 投稿」一条流，
 * 但页面是 11 个平级抽屉，用户经常不知道"现在在哪、下一步点哪"。
 * 这条横条把叙事显性化：已完成阶段打勾、当前阶段高亮、有卡点显示数字，
 * 点任意阶段直达对应工作区。窄屏压缩为「当前阶段 + 进度 n/6」。
 */
export function StageBar(props: StageBarProps) {
  const { view, onNavigate } = props;
  const stages: StageState[] = useMemo(
    () =>
      deriveStages({
        project: props.project,
        overview: props.overview,
        docCount: props.docCount,
        hasContent: props.hasContent,
        score: props.score,
        reviewedDocCount: props.reviewedDocCount,
        submissionCount: props.submissionCount,
        view,
      }),
    [props.project, props.overview, props.docCount, props.hasContent, props.score, props.reviewedDocCount, props.submissionCount, view],
  );

  const doneCount = stages.filter((s) => s.done).length;
  const activeStage = stageOfView(view);
  const currentLabel = stages.find((s) => s.current)?.label ?? '选题';

  return (
    <nav aria-label="项目阶段" className="stage-bar">
      {/* 窄屏：只显示进度摘要 */}
      <div className="stage-bar__compact">
        <span className="stage-bar__compact-label">项目进度</span>
        <span className="stage-bar__compact-value">
          {doneCount}/{stages.length} · 当前 {currentLabel}
        </span>
        <div className="stage-bar__compact-track" aria-hidden="true">
          <span style={{ width: `${(doneCount / stages.length) * 100}%` }} />
        </div>
      </div>

      {/* 宽屏：完整六阶段 */}
      <ol className="stage-bar__list">
        {stages.map((s, i) => {
          const isActive = activeStage === s.key;
          const cls = s.done ? 'is-done' : s.current ? 'is-current' : 'is-todo';
          return (
            <li key={s.key} className="stage-bar__item">
              <button
                type="button"
                onClick={() => onNavigate(s.view)}
                className={`stage-bar__btn ${cls} ${isActive ? 'is-active' : ''}`}
                aria-current={isActive ? 'step' : undefined}
                title={`${s.label} · ${s.hint}${s.pending ? ` · ${s.pending} 项待处理` : ''}`}
              >
                <span className="stage-bar__index" aria-hidden="true">
                  {s.done ? '✓' : i + 1}
                </span>
                <span className="stage-bar__label">{s.label}</span>
                {s.pending > 0 && <span className="stage-bar__badge">{s.pending}</span>}
              </button>
              {i < stages.length - 1 && <span className={`stage-bar__sep ${s.done ? 'is-done' : ''}`} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export type { StageKey };
