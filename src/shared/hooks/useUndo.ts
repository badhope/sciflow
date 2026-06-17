import { useCallback, useState } from 'react';
import { useAppStore } from '../store';
import { Task, Project, Note, Goal, Habit } from '../types';
import { toast } from '../components/common/Toast';

type UndoableAction = {
  id: string;
  type: 'task' | 'project' | 'note' | 'goal' | 'habit' | 'view' | 'category' | 'tag' | 'template' | 'automation';
  data: any;
  undo: () => void;
  message: string;
};

const undoStack: UndoableAction[] = [];
let listeners: Array<(action: UndoableAction | null) => void> = [];

function notify() {
  listeners.forEach(l => l(undoStack[0] || null));
}

export function pushUndo(action: Omit<UndoableAction, 'id'>) {
  const id = `undo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  undoStack.unshift({ id, ...action });
  notify();
}

export function popUndo(): UndoableAction | null {
  const action = undoStack.shift() || null;
  notify();
  return action;
}

export function useUndoQueue() {
  const [current, setCurrent] = useState<UndoableAction | null>(undoStack[0] || null);

  return {
    current,
    listen: useCallback((cb: (action: UndoableAction | null) => void) => {
      const wrapper = (a: UndoableAction | null) => {
        setCurrent(a);
        cb(a);
      };
      listeners.push(wrapper);
      return () => {
        listeners = listeners.filter(l => l !== wrapper);
      };
    }, []),
  };
}

export function undoDeleteTask(task: Task) {
  const { tasks, addTask } = useAppStore.getState();
  const index = tasks.findIndex(t => t.id === task.id);
  addTask(task);
  // Move to original position if possible
  setTimeout(() => {
    const state = useAppStore.getState();
    const newIndex = state.tasks.findIndex(t => t.id === task.id);
    if (newIndex !== -1 && index !== -1 && newIndex !== index) {
      const reordered = [...state.tasks];
      const [moved] = reordered.splice(newIndex, 1);
      reordered.splice(Math.min(index, reordered.length), 0, moved);
      useAppStore.setState({ tasks: reordered });
    }
  }, 0);
  popUndo();
}

export function undoDeleteProject(project: Project) {
  useAppStore.getState().addProject(project);
  popUndo();
}

export function undoDeleteNote(note: Note) {
  useAppStore.getState().addNote(note);
  popUndo();
}

export function undoDeleteGoal(goal: Goal) {
  useAppStore.getState().addGoal(goal);
  popUndo();
}

export function undoDeleteHabit(habit: Habit) {
  useAppStore.getState().addHabit(habit);
  popUndo();
}

export function withUndo<T>(
  action: T,
  undoFn: () => void,
  message: string,
  actionType: UndoableAction['type'],
  data?: any
): T {
  pushUndo({ type: actionType, data, undo: undoFn, message });
  toast.withAction(message, '撤销', () => undoFn(), 'info');
  return action;
}

export function confirmAndExecute(
  type: UndoableAction['type'],
  data: any,
  execute: () => void,
  undo: () => void,
  message: string
) {
  execute();
  pushUndo({ type, data, undo, message });
  toast.withAction(message, '撤销', () => undo(), 'info');
}
