import { describe, expect, it } from 'vitest';
import {
  bestLeaf,
  branchMeta,
  normalizeMessageTree,
  pathToLeaf,
  removeSubtree,
  switchBranchTarget,
  type BranchNode,
} from './chat-branch';

interface Node extends BranchNode {
  role: 'user' | 'assistant';
  content: string;
}

const node = (id: string, role: 'user' | 'assistant', content: string, parentId: string | null, createdAt: number): Node => ({
  id, role, content, parentId, createdAt,
});

describe('chat branch tree', () => {
  it('legacy linear messages get stable ids and a parent chain', () => {
    const { items, leafId } = normalizeMessageTree<Node>([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ]);
    expect(items[0].id).toBeTruthy();
    expect(items[0].parentId).toBeNull();
    expect(items[1].parentId).toBe(items[0].id);
    expect(leafId).toBe(items[1].id);
    expect(pathToLeaf(items, leafId).map((m) => m.content)).toEqual(['q1', 'a1']);
  });

  it('edited question appends a user sibling and keeps the old answer branch', () => {
    const base = normalizeMessageTree<Node>([
      node('u1', 'user', '原问题', null, 1),
      node('a1', 'assistant', '原回答', 'u1', 2),
    ]);
    const edited = [...base.items, node('u2', 'user', '改后问题', null, 3), node('a2', 'assistant', '改后回答', 'u2', 4)];
    expect(branchMeta(edited).u1).toMatchObject({ index: 0, count: 2 });
    expect(branchMeta(edited).u2).toMatchObject({ index: 1, count: 2 });
    expect(pathToLeaf(edited, 'a2').map((m) => m.content)).toEqual(['改后问题', '改后回答']);
    // 切回旧问题：沿旧分支走到旧回答，旧内容没有丢。
    const target = switchBranchTarget(edited, 'u2', -1);
    expect(target).toBe('a1');
    expect(pathToLeaf(edited, target!).map((m) => m.content)).toEqual(['原问题', '原回答']);
  });

  it('three answers under one question switch both ways', () => {
    const items = [
      node('q', 'user', '问题', null, 1),
      node('a1', 'assistant', '版本一', 'q', 2),
      node('a2', 'assistant', '版本二', 'q', 3),
      node('a3', 'assistant', '版本三', 'q', 4),
    ];
    expect(branchMeta(items).a2).toMatchObject({ index: 1, count: 3 });
    expect(switchBranchTarget(items, 'a1', 1)).toBe('a2');
    expect(switchBranchTarget(items, 'a2', 1)).toBe('a3');
    expect(switchBranchTarget(items, 'a3', -1)).toBe('a2');
    expect(switchBranchTarget(items, 'a1', -1)).toBeNull();
    expect(pathToLeaf(items, 'a3').map((m) => m.content)).toEqual(['问题', '版本三']);
  });

  it('removing a branch keeps other branches and finds a safe leaf', () => {
    const items = [
      node('u1', 'user', '原问题', null, 1),
      node('a1', 'assistant', '原回答', 'u1', 2),
      node('u2', 'user', '新问题', null, 3),
      node('a2', 'assistant', '新回答', 'u2', 4),
    ];
    const left = removeSubtree(items, 'u1');
    expect(left.map((m) => m.id)).toEqual(['u2', 'a2']);
    expect(bestLeaf(left, 'u2')).toBe('a2');
  });

  it('dangling parents are promoted to roots and cycles are broken', () => {
    const dangling = normalizeMessageTree<Node>([
      node('a', 'user', 'A', 'missing', 1),
      node('b', 'assistant', 'B', 'a', 2),
    ]);
    expect(dangling.items[0].parentId).toBeNull();
    expect(dangling.items[1].parentId).toBe('a');

    const cycle = normalizeMessageTree<Node>([
      node('x', 'user', 'X', 'y', 1),
      node('y', 'assistant', 'Y', 'x', 2),
    ]);
    expect(pathToLeaf(cycle.items, 'y')).toHaveLength(2);
    expect(cycle.items.some((m) => m.parentId === null)).toBe(true);
  });
});
