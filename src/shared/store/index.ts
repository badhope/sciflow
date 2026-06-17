import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Task,
  Project,
  Category,
  Tag,
  View,
  Calendar,
  CalendarEvent,
  Reminder,
  Goal,
  Habit,
  Note,
  User,
  Theme,
  ThemePreset,
  Filter,
  SortOption,
  DashboardStats,
  AISuggestion,
  AIInsight,
  SyncConfig,
  Notification,
  AutomationRule,
  Template,
  Team,
  Activity,
  Comment,
  Attachment,
  ChecklistItem,
  UserPreferences,
  NotificationPreferences,
  DisplaySettings,
  FocusSession,
  PrivacySettings,
} from '../types';

interface AppStore {
  // Auth
  user: User | null;
  isAuthenticated: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;

  // Tasks
  // Kept flat (not normalised) because the dataset is small (<5k tasks
  // for any realistic user) and FlatList needs the array shape anyway.
  // If we ever ship a server-backed sync, switch to a Record<id, Task>
  // index and re-derive the array in a selector.
  tasks: Task[];
  selectedTask: Task | null;
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  selectTask: (task: Task | null) => void;
  toggleTaskComplete: (id: string) => void;
  archiveTask: (id: string) => void;
  restoreTask: (id: string) => void;
  duplicateTask: (id: string) => void;
  moveTask: (id: string, targetId: string) => void;
  sortTasks: (tasks: Task[], sortOptions: SortOption[]) => Task[];
  filterTasks: (tasks: Task[], filters: Filter[]) => Task[];

  addSubtask: (taskId: string, subtask: { id: string; title: string; completed: boolean; order: number }) => void;
  updateSubtask: (taskId: string, subtaskId: string, updates: Partial<{ id: string; title: string; completed: boolean; order: number }>) => void;
  deleteSubtask: (taskId: string, subtaskId: string) => void;
  addComment: (taskId: string, comment: { id: string; content: string; authorId: string; authorName: string; createdAt: Date; updatedAt: Date }) => void;
  addAttachment: (taskId: string, attachment: Attachment) => void;
  addChecklistItem: (taskId: string, item: { id: string; text: string; completed: boolean; order: number }) => void;
  toggleChecklistItem: (taskId: string, itemId: string) => void;
  deleteChecklistItem: (taskId: string, itemId: string) => void;
  addTagToTask: (taskId: string, tagId: string) => void;
  removeTagFromTask: (taskId: string, tagId: string) => void;
  setSidebarOpen: (open: boolean) => void;

  // Projects
  projects: Project[];
  selectedProject: Project | null;
  addProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  selectProject: (project: Project | null) => void;
  archiveProject: (id: string) => void;
  getProjectTasks: (projectId: string) => Task[];

  // Categories
  categories: Category[];
  selectedCategory: string | null;
  addCategory: (category: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateCategory: (id: string, updates: Partial<Category>) => void;
  deleteCategory: (id: string) => void;
  setSelectedCategory: (id: string | null) => void;
  reorderCategories: (categories: Category[]) => void;
  reorderTasks: (tasks: Task[]) => void;

  // Tags
  tags: Tag[];
  addTag: (tag: Omit<Tag, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTag: (id: string, updates: Partial<Tag>) => void;
  deleteTag: (id: string) => void;
  mergeTags: (sourceId: string, targetId: string) => void;

  // Views
  views: View[];
  activeView: View | null;
  addView: (view: Omit<View, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateView: (id: string, updates: Partial<View>) => void;
  deleteView: (id: string) => void;
  setActiveView: (view: View | null) => void;
  setDefaultViews: () => void;

  // Calendar
  calendars: Calendar[];
  events: CalendarEvent[];
  selectedDate: Date;
  calendarViewType: 'day' | 'week' | 'month' | 'year';
  addCalendar: (calendar: Omit<Calendar, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateCalendar: (id: string, updates: Partial<Calendar>) => void;
  deleteCalendar: (id: string) => void;
  addEvent: (event: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => void;
  deleteEvent: (id: string) => void;
  setSelectedDate: (date: Date) => void;
  setCalendarViewType: (type: 'day' | 'week' | 'month' | 'year') => void;
  getEventsForDate: (date: Date) => CalendarEvent[];
  getEventsForRange: (start: Date, end: Date) => CalendarEvent[];

  // Reminders
  reminders: Reminder[];
  addReminder: (reminder: Omit<Reminder, 'id' | 'createdAt'>) => string;
  updateReminder: (id: string, updates: Partial<Reminder>) => void;
  deleteReminder: (id: string) => void;
  snoozeReminder: (id: string, minutes: number) => void;

  // Goals
  goals: Goal[];
  selectedGoal: Goal | null;
  addGoal: (goal: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateGoal: (id: string, updates: Partial<Goal>) => void;
  deleteGoal: (id: string) => void;
  selectGoal: (goal: Goal | null) => void;
  progressGoal: (id: string, value: number) => void;
  completeGoal: (id: string) => void;

  // Habits
  habits: Habit[];
  selectedHabit: Habit | null;
  addHabit: (habit: Omit<Habit, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateHabit: (id: string, updates: Partial<Habit>) => void;
  deleteHabit: (id: string) => void;
  selectHabit: (habit: Habit | null) => void;
  completeHabit: (id: string, date: string) => void;
  uncompleteHabit: (id: string, date: string) => void;
  getHabitStreak: (id: string) => number;

  // Notes
  notes: Note[];
  selectedNote: Note | null;
  addNote: (note: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateNote: (id: string, updates: Partial<Note>) => void;
  deleteNote: (id: string) => void;
  selectNote: (note: Note | null) => void;
  archiveNote: (id: string) => void;
  pinNote: (id: string) => void;

  // AI
  aiSuggestions: AISuggestion[];
  aiInsights: AIInsight[];
  addAISuggestion: (suggestion: AISuggestion) => void;
  acceptAISuggestion: (id: string) => void;
  dismissAISuggestion: (id: string) => void;
  clearOldSuggestions: () => void;

  // Analytics
  dashboardStats: DashboardStats | null;
  calculateDashboardStats: () => void;
  getTaskStats: (taskIds: string[]) => any;
  getProductivityScore: () => number;
  getCompletionRate: () => number;
  getStreak: () => number;

  // UI State
  theme: ThemePreset;
  sidebarOpen: boolean;
  activeModal: string | null;
  activeTab: string;
  searchQuery: string;
  isSearchOpen: boolean;
  notifications: Notification[];
  unreadNotificationCount: number;
  setTheme: (theme: ThemePreset | { type: Theme }) => void;
  toggleSidebar: () => void;
  setActiveModal: (modal: string | null) => void;
  setActiveTab: (tab: string) => void;
  setSearchQuery: (query: string) => void;
  toggleSearch: () => void;
  addNotification: (notification: Notification) => void;
  markNotificationRead: (id: string) => void;
  clearNotifications: () => void;

  // User Preferences (持久化)
  userPreferences: UserPreferences;
  updateUserPreferences: (prefs: Partial<UserPreferences>) => void;
  updateNotificationSettings: (settings: Partial<NotificationPreferences>) => void;
  updateDisplaySettings: (settings: Partial<DisplaySettings>) => void;
  updatePrivacySettings: (settings: Partial<PrivacySettings>) => void;

  // Automation
  automationRules: AutomationRule[];
  addAutomationRule: (rule: Omit<AutomationRule, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateAutomationRule: (id: string, updates: Partial<AutomationRule>) => void;
  deleteAutomationRule: (id: string) => void;
  toggleAutomationRule: (id: string) => void;
  executeAutomation: (ruleId: string, context: any) => void;

  // Templates
  templates: Template[];
  addTemplate: (template: Omit<Template, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTemplate: (id: string, updates: Partial<Template>) => void;
  deleteTemplate: (id: string) => void;
  applyTemplate: (templateId: string, variables?: any) => any;

  // Teams
  teams: Team[];
  currentTeam: Team | null;
  activities: Activity[];
  addTeam: (team: Omit<Team, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTeam: (id: string, updates: Partial<Team>) => void;
  deleteTeam: (id: string) => void;
  setCurrentTeam: (team: Team | null) => void;
  addTeamMember: (teamId: string, member: any) => void;
  removeTeamMember: (teamId: string, memberId: string) => void;
  updateTeamMember: (teamId: string, memberId: string, updates: any) => void;
  addActivity: (activity: Omit<Activity, 'id' | 'createdAt'>) => void;

  // Sync & Backup
  syncConfig: SyncConfig;
  lastSyncAt: Date | null;
  isSyncing: boolean;
  setSyncConfig: (config: SyncConfig) => void;
  performSync: () => Promise<void>;
  setLastSyncAt: (date: Date) => void;

  // Focus Sessions (Pomodoro)
  sessions: FocusSession[];
  addSession: (session: Omit<FocusSession, 'id'>) => void;
  clearSessions: () => void;

  // UI state (persisted, but not really "data")
  searchHistory: string[];
  addSearchToHistory: (query: string) => void;
  clearSearchHistory: () => void;

  // Persistence
  loadData: () => Promise<void>;
  saveData: () => Promise<void>;
  exportData: () => Promise<string>;
  importData: (data: string) => Promise<void>;
  resetData: () => void;
}

// Default theme
const defaultTheme: ThemePreset = {
  id: 'default-light',
  name: 'Light',
  type: 'light',
  colors: {
    primary: '#5B6CFF',
    primaryDark: '#3B4DDB',
    primaryLight: '#8B97FF',
    onPrimary: '#FFFFFF',
    secondary: '#9D7BFF',
    accent: '#FF6B9D',
    background: '#F7F8FC',
    surface: '#FFFFFF',
    card: '#FFFFFF',
    cardElevated: '#FFFFFF',
    text: '#0F172A',
    textSecondary: '#64748B',
    textTertiary: '#94A3B8',
    textDisabled: '#CBD5E1',
    border: '#E2E8F0',
    borderStrong: '#CBD5E1',
    error: '#EF4444',
    warning: '#F59E0B',
    success: '#10B981',
    info: '#0EA5E9',
    divider: '#F1F5F9',
    overlay: 'rgba(15, 23, 42, 0.55)',
    glassBackground: 'rgba(255, 255, 255, 0.85)',
    glassBorder: 'rgba(255, 255, 255, 0.5)',
    shimmer: '#F1F5F9',
    priorities: {
      low: '#10B981',
      medium: '#F59E0B',
      high: '#F97316',
      urgent: '#EF4444',
      critical: '#DC2626',
    },
    status: {
      todo: '#94A3B8',
      'in-progress': '#5B6CFF',
      waiting: '#F59E0B',
      delegated: '#9D7BFF',
      completed: '#10B981',
      cancelled: '#EF4444',
      'on-hold': '#64748B',
    },
    categories: {},
  },
  typography: {
    fontFamily: 'System',
    fontSizeXs: 11,
    fontSizeSm: 13,
    fontSizeBase: 15,
    fontSizeLg: 17,
    fontSizeXl: 20,
    fontSize2xl: 24,
    fontSize3xl: 30,
    fontSize4xl: 36,
    fontWeightLight: 300,
    fontWeightNormal: 400,
    fontWeightMedium: 500,
    fontWeightSemibold: 600,
    fontWeightBold: 700,
    lineHeightTight: 1.2,
    lineHeightNormal: 1.45,
    lineHeightRelaxed: 1.7,
    letterSpacingTight: -0.4,
    letterSpacingNormal: 0,
    letterSpacingWide: 0.4,
  },
  spacing: {
    space1: 4,
    space2: 8,
    space3: 12,
    space4: 16,
    space5: 20,
    space6: 24,
    space7: 28,
    space8: 32,
    space10: 40,
    space12: 48,
    space16: 64,
  },
  borderRadius: {
    none: 0,
    xs: 6,
    sm: 8,
    base: 12,
    md: 14,
    lg: 18,
    xl: 22,
    '2xl': 28,
    full: 9999,
  },
  shadows: {
    none: 'transparent',
    xs: '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
    sm: '0 1px 3px 0 rgba(15, 23, 42, 0.06), 0 1px 2px 0 rgba(15, 23, 42, 0.04)',
    base: '0 2px 4px -1px rgba(15, 23, 42, 0.06), 0 1px 2px 0 rgba(15, 23, 42, 0.04)',
    md: '0 6px 12px -2px rgba(15, 23, 42, 0.08), 0 3px 6px -1px rgba(15, 23, 42, 0.04)',
    lg: '0 12px 20px -4px rgba(15, 23, 42, 0.10), 0 6px 8px -2px rgba(15, 23, 42, 0.05)',
    xl: '0 24px 32px -6px rgba(15, 23, 42, 0.12), 0 12px 12px -4px rgba(15, 23, 42, 0.05)',
    '2xl': '0 32px 48px -8px rgba(15, 23, 42, 0.15), 0 16px 16px -4px rgba(15, 23, 42, 0.05)',
    inner: 'inset 0 2px 4px 0 rgba(15, 23, 42, 0.04)',
    ring: '0 0 0 3px rgba(91, 108, 255, 0.18)',
  },
  isCustom: false,
  isSystem: true,
  createdAt: new Date(),
};

const darkTheme: ThemePreset = {
  id: 'default-dark',
  name: 'Dark',
  type: 'dark',
  colors: {
    primary: '#8B97FF',
    primaryDark: '#5B6CFF',
    primaryLight: '#A8B1FF',
    onPrimary: '#0F172A',
    secondary: '#B79DFF',
    accent: '#FF8FB3',
    background: '#0B1020',
    surface: '#161B2E',
    card: '#1B2138',
    cardElevated: '#222842',
    text: '#F1F5F9',
    textSecondary: '#94A3B8',
    textTertiary: '#64748B',
    textDisabled: '#475569',
    border: '#2A3050',
    borderStrong: '#3B4366',
    error: '#F87171',
    warning: '#FBBF24',
    success: '#34D399',
    info: '#38BDF8',
    divider: '#1F2540',
    overlay: 'rgba(0, 0, 0, 0.75)',
    glassBackground: 'rgba(22, 27, 46, 0.85)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
    shimmer: '#1F2540',
    priorities: {
      low: '#34D399',
      medium: '#FBBF24',
      high: '#FB923C',
      urgent: '#F87171',
      critical: '#EF4444',
    },
    status: {
      todo: '#64748B',
      'in-progress': '#8B97FF',
      waiting: '#FBBF24',
      delegated: '#B79DFF',
      completed: '#34D399',
      cancelled: '#F87171',
      'on-hold': '#475569',
    },
    categories: {},
  },
  typography: {
    fontFamily: 'System',
    fontSizeXs: 11,
    fontSizeSm: 13,
    fontSizeBase: 15,
    fontSizeLg: 17,
    fontSizeXl: 20,
    fontSize2xl: 24,
    fontSize3xl: 30,
    fontSize4xl: 36,
    fontWeightLight: 300,
    fontWeightNormal: 400,
    fontWeightMedium: 500,
    fontWeightSemibold: 600,
    fontWeightBold: 700,
    lineHeightTight: 1.2,
    lineHeightNormal: 1.45,
    lineHeightRelaxed: 1.7,
    letterSpacingTight: -0.4,
    letterSpacingNormal: 0,
    letterSpacingWide: 0.4,
  },
  spacing: {
    space1: 4,
    space2: 8,
    space3: 12,
    space4: 16,
    space5: 20,
    space6: 24,
    space7: 28,
    space8: 32,
    space10: 40,
    space12: 48,
    space16: 64,
  },
  borderRadius: {
    none: 0,
    xs: 6,
    sm: 8,
    base: 12,
    md: 14,
    lg: 18,
    xl: 22,
    '2xl': 28,
    full: 9999,
  },
  shadows: {
    none: 'transparent',
    xs: '0 1px 2px 0 rgba(0, 0, 0, 0.20)',
    sm: '0 1px 3px 0 rgba(0, 0, 0, 0.30), 0 1px 2px 0 rgba(0, 0, 0, 0.20)',
    base: '0 2px 4px -1px rgba(0, 0, 0, 0.30), 0 1px 2px 0 rgba(0, 0, 0, 0.20)',
    md: '0 6px 12px -2px rgba(0, 0, 0, 0.35), 0 3px 6px -1px rgba(0, 0, 0, 0.20)',
    lg: '0 12px 20px -4px rgba(0, 0, 0, 0.40), 0 6px 8px -2px rgba(0, 0, 0, 0.25)',
    xl: '0 24px 32px -6px rgba(0, 0, 0, 0.45), 0 12px 12px -4px rgba(0, 0, 0, 0.25)',
    '2xl': '0 32px 48px -8px rgba(0, 0, 0, 0.50), 0 16px 16px -4px rgba(0, 0, 0, 0.25)',
    inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.20)',
    ring: '0 0 0 3px rgba(139, 151, 255, 0.25)',
  },
  isCustom: false,
  isSystem: true,
  createdAt: new Date(),
};

// Initial categories
const initialCategories: Category[] = [
  {
    id: 'cat-1',
    name: '工作',
    description: '工作相关任务',
    color: '#3B82F6',
    icon: 'briefcase',
    parentCategoryId: null,
    childCategoryIds: [],
    isSystem: true,
    isArchived: false,
    taskCount: 0,
    order: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    projectId: null,
  },
  {
    id: 'cat-2',
    name: '个人',
    description: '个人生活任务',
    color: '#10B981',
    icon: 'user',
    parentCategoryId: null,
    childCategoryIds: [],
    isSystem: true,
    isArchived: false,
    taskCount: 0,
    order: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    projectId: null,
  },
  {
    id: 'cat-3',
    name: '学习',
    description: '学习和教育任务',
    color: '#F59E0B',
    icon: 'book',
    parentCategoryId: null,
    childCategoryIds: [],
    isSystem: true,
    isArchived: false,
    taskCount: 0,
    order: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    projectId: null,
  },
  {
    id: 'cat-4',
    name: '健康',
    description: '健康和运动',
    color: '#EF4444',
    icon: 'heart',
    parentCategoryId: null,
    childCategoryIds: [],
    isSystem: true,
    isArchived: false,
    taskCount: 0,
    order: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    projectId: null,
  },
  {
    id: 'cat-5',
    name: '购物',
    description: '购物和杂项',
    color: '#8B5CF6',
    icon: 'shopping-cart',
    parentCategoryId: null,
    childCategoryIds: [],
    isSystem: true,
    isArchived: false,
    taskCount: 0,
    order: 4,
    createdAt: new Date(),
    updatedAt: new Date(),
    projectId: null,
  },
];

// Initial tags
const initialTags: Tag[] = [
  { id: 'tag-1', name: '紧急', color: '#EF4444', icon: 'alert-circle', isSystem: true, usageCount: 0, createdAt: new Date(), updatedAt: new Date(), createdBy: null },
  { id: 'tag-2', name: '重要', color: '#F59E0B', icon: 'star', isSystem: true, usageCount: 0, createdAt: new Date(), updatedAt: new Date(), createdBy: null },
  { id: 'tag-3', name: '待定', color: '#6B7280', icon: 'clock', isSystem: true, usageCount: 0, createdAt: new Date(), updatedAt: new Date(), createdBy: null },
  { id: 'tag-4', name: '灵感', color: '#8B5CF6', icon: 'lightbulb', isSystem: true, usageCount: 0, createdAt: new Date(), updatedAt: new Date(), createdBy: null },
];

// Default views
const defaultViews: View[] = [
  {
    id: 'view-list',
    name: '列表视图',
    type: 'list',
    isSystem: true,
    isFavorite: true,
    projectId: null,
    filters: [],
    sortOptions: [{ id: 'sort-1', field: 'createdAt', direction: 'desc', priority: 0 }],
    groupBy: null,
    layout: {
      density: 'comfortable',
      cardStyle: 'detailed',
      showCompleted: true,
      showProgress: true,
      showTags: true,
      showDueDate: true,
      showPriority: true,
      showAssignee: false,
      showTime: false,
      showLocation: false,
      compactMode: false,
      showArchived: false,
      paginationSize: 50,
      infiniteScroll: true,
    },
    colorSchema: 'default',
    icon: 'list',
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
  },
  {
    id: 'view-kanban',
    name: '看板视图',
    type: 'kanban',
    isSystem: true,
    isFavorite: false,
    projectId: null,
    filters: [],
    sortOptions: [{ id: 'sort-2', field: 'order', direction: 'asc', priority: 0 }],
    groupBy: null,
    layout: {
      density: 'comfortable',
      cardStyle: 'minimal',
      showCompleted: true,
      showProgress: false,
      showTags: true,
      showDueDate: true,
      showPriority: true,
      showAssignee: false,
      showTime: false,
      showLocation: false,
      compactMode: false,
      showArchived: false,
      paginationSize: 100,
      infiniteScroll: true,
    },
    colorSchema: 'default',
    icon: 'columns',
    kanbanColumns: [
      { id: 'col-1', title: '待办', statuses: ['todo'], wipLimit: null, color: '#6B7280', order: 0, collapsed: false },
      { id: 'col-2', title: '进行中', statuses: ['in-progress', 'waiting'], wipLimit: null, color: '#3B82F6', order: 1, collapsed: false },
      { id: 'col-3', title: '已完成', statuses: ['completed'], wipLimit: null, color: '#10B981', order: 2, collapsed: false },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
  },
  {
    id: 'view-calendar',
    name: '日历视图',
    type: 'calendar',
    isSystem: true,
    isFavorite: false,
    projectId: null,
    filters: [],
    sortOptions: [],
    groupBy: null,
    layout: {
      density: 'compact',
      cardStyle: 'minimal',
      showCompleted: false,
      showProgress: false,
      showTags: true,
      showDueDate: true,
      showPriority: false,
      showAssignee: false,
      showTime: false,
      showLocation: false,
      compactMode: true,
      showArchived: false,
      paginationSize: 100,
      infiniteScroll: false,
    },
    colorSchema: 'default',
    icon: 'calendar',
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
  },
  {
    id: 'view-timeline',
    name: '时间线',
    type: 'timeline',
    isSystem: true,
    isFavorite: false,
    projectId: null,
    filters: [],
    sortOptions: [{ id: 'sort-3', field: 'startDate', direction: 'asc', priority: 0 }],
    groupBy: null,
    layout: {
      density: 'comfortable',
      cardStyle: 'minimal',
      showCompleted: true,
      showProgress: true,
      showTags: false,
      showDueDate: true,
      showPriority: true,
      showAssignee: false,
      showTime: true,
      showLocation: false,
      compactMode: false,
      showArchived: false,
      paginationSize: 100,
      infiniteScroll: true,
    },
    colorSchema: 'default',
    icon: 'clock',
    timelineConfig: {
      showToday: true,
      showWeekends: true,
      showMilestones: true,
      zoomLevel: 'week',
      dateFormat: 'YYYY-MM-DD',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
  },
];

// Storage keys
const STORAGE_KEYS = {
  USER: 'taskflow_user',
  TASKS: 'taskflow_tasks',
  PROJECTS: 'taskflow_projects',
  CATEGORIES: 'taskflow_categories',
  TAGS: 'taskflow_tags',
  VIEWS: 'taskflow_views',
  CALENDARS: 'taskflow_calendars',
  EVENTS: 'taskflow_events',
  REMINDERS: 'taskflow_reminders',
  GOALS: 'taskflow_goals',
  HABITS: 'taskflow_habits',
  NOTES: 'taskflow_notes',
  THEME: 'taskflow_theme',
  SYNC_CONFIG: 'taskflow_sync_config',
  LAST_SYNC: 'taskflow_last_sync',
  AUTOMATION: 'taskflow_automation',
  TEMPLATES: 'taskflow_templates',
  TEAMS: 'taskflow_teams',
  SESSIONS: 'taskflow_sessions',
  USER_PREFERENCES: 'taskflow_user_preferences',
  SIDEBAR_OPEN: 'taskflow_sidebar_open',
  SEARCH_HISTORY: 'taskflow_search_history',
};

// Helper functions
const generateId = (): string => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const deepClone = <T>(obj: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
};

// Create store
export const useAppStore = create<AppStore>((set, get) => ({
  // Auth
  user: null,
  isAuthenticated: false,

  login: (user, token) => {
    set({ user, isAuthenticated: true });
    AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ user, token }));
  },

  logout: () => {
    set({ user: null, isAuthenticated: false });
    AsyncStorage.removeItem(STORAGE_KEYS.USER);
  },

  // Pomodoro sessions
  sessions: [],

  addSession: (session) => {
    const newSession = {
      ...session,
      id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
    set(state => ({
      sessions: [newSession, ...(state.sessions || [])].slice(0, 100),
    }));
    get().saveData();
  },

  clearSessions: () => {
    set({ sessions: [] });
    get().saveData();
  },

  // Search history — kept here (not local useState) so it survives
  // screen unmounts. Capped at 10 entries to bound storage growth.
  searchHistory: [],

  addSearchToHistory: (query) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    set((state) => {
      const filtered = state.searchHistory.filter((q) => q !== trimmed);
      return { searchHistory: [trimmed, ...filtered].slice(0, 10) };
    });
    get().saveData();
  },

  clearSearchHistory: () => {
    set({ searchHistory: [] });
    get().saveData();
  },

  // Tasks
  tasks: [],
  selectedTask: null,

  addTask: (task) => {
    const id = generateId();
    const newTask: Task = {
      ...task,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    set((state) => ({ tasks: [...state.tasks, newTask] }));
    get().saveData();
    return id;
  },

  updateTask: (id, updates) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id ? { ...task, ...updates, updatedAt: new Date() } : task
      ),
    }));
    get().saveData();
  },

  deleteTask: (id) => {
    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== id),
      selectedTask: state.selectedTask?.id === id ? null : state.selectedTask,
    }));
    get().saveData();
  },

  selectTask: (task) => set({ selectedTask: task }),

  toggleTaskComplete: (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (task) {
      get().updateTask(id, {
        completed: !task.completed,
        completedAt: !task.completed ? new Date() : null,
        status: !task.completed ? 'completed' : 'todo',
      });
    }
  },

  archiveTask: (id) => {
    get().updateTask(id, { isArchived: true });
  },

  restoreTask: (id) => {
    get().updateTask(id, { isArchived: false });
  },

  duplicateTask: (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (task) {
      const { id: _, createdAt: __, updatedAt: ___, ...taskData } = deepClone(task);
      get().addTask(taskData as Omit<Task, 'id' | 'createdAt' | 'updatedAt'>);
    }
  },

  moveTask: (id, targetId) => {
    const tasks = get().tasks;
    const taskIndex = tasks.findIndex((t) => t.id === id);
    const targetIndex = tasks.findIndex((t) => t.id === targetId);
    if (taskIndex !== -1 && targetIndex !== -1) {
      const newTasks = [...tasks];
      const [task] = newTasks.splice(taskIndex, 1);
      newTasks.splice(targetIndex, 0, task);
      set({ tasks: newTasks });
      get().saveData();
    }
  },

  sortTasks: (tasks, sortOptions) => {
    return [...tasks].sort((a, b) => {
      for (const option of sortOptions) {
        const aVal = (a as any)[option.field];
        const bVal = (b as any)[option.field];
        if (aVal === bVal) continue;
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;
        const comparison = aVal < bVal ? -1 : 1;
        return option.direction === 'asc' ? comparison : -comparison;
      }
      return 0;
    });
  },

  filterTasks: (tasks, filters) => {
    return tasks.filter((task) => {
      return filters.every((filter) => {
        const value = (task as any)[filter.field];
        const filterValue = filter.value;
        switch (filter.operator) {
          case 'equals':
            return value === filterValue;
          case 'not-equals':
            return value !== filterValue;
          case 'contains':
            return String(value).toLowerCase().includes(String(filterValue).toLowerCase());
          case 'greater-than':
            return value > filterValue;
          case 'less-than':
            return value < filterValue;
          case 'in':
            return filterValue.includes(value);
          case 'is-empty':
            return value === null || value === undefined || value === '';
          case 'is-not-empty':
            return value !== null && value !== undefined && value !== '';
          default:
            return true;
        }
      });
    });
  },

  addSubtask: (taskId, subtask) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (task) {
      get().updateTask(taskId, { subtasks: [...task.subtasks, subtask] });
    }
  },

  updateSubtask: (taskId, subtaskId, updates) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (task) {
      get().updateTask(taskId, {
        subtasks: task.subtasks.map((s) => (s.id === subtaskId ? { ...s, ...updates } : s)),
      });
    }
  },

  deleteSubtask: (taskId, subtaskId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (task) {
      get().updateTask(taskId, { subtasks: task.subtasks.filter((s) => s.id !== subtaskId) });
    }
  },

  addComment: (taskId, comment) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (task) {
      const newComment: Comment = {
        id: comment.id,
        content: comment.content,
        authorId: comment.authorId,
        authorName: comment.authorName,
        authorAvatar: undefined,
        taskId,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        mentions: [],
        likes: 0,
        isEdited: false,
        parentCommentId: null,
        replies: [],
      };
      get().updateTask(taskId, { comments: [...task.comments, newComment] });
    }
  },

  addAttachment: (taskId, attachment) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (task) {
      get().updateTask(taskId, { attachments: [...task.attachments, attachment] });
    }
  },

  addChecklistItem: (taskId, item) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (task) {
      const newItem: ChecklistItem = {
        id: item.id,
        text: item.text,
        completed: item.completed,
        completedAt: item.completed ? new Date() : null,
        order: item.order,
        dueDate: null,
        assigneeId: null,
        createdAt: new Date(),
      };
      get().updateTask(taskId, { checklist: [...task.checklist, newItem] });
    }
  },

  toggleChecklistItem: (taskId, itemId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (task) {
      get().updateTask(taskId, {
        checklist: task.checklist.map((c) =>
          c.id === itemId
            ? { ...c, completed: !c.completed, completedAt: !c.completed ? new Date() : null }
            : c
        ),
      });
    }
  },

  deleteChecklistItem: (taskId, itemId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (task) {
      get().updateTask(taskId, { checklist: task.checklist.filter((c) => c.id !== itemId) });
    }
  },

  addTagToTask: (taskId, tagId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (task && !task.tags.includes(tagId)) {
      get().updateTask(taskId, { tags: [...task.tags, tagId] });
    }
  },

  removeTagFromTask: (taskId, tagId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (task) {
      get().updateTask(taskId, { tags: task.tags.filter((t) => t !== tagId) });
    }
  },

  // Projects
  projects: [],
  selectedProject: null,

  addProject: (project) => {
    const id = generateId();
    const newProject: Project = {
      ...project,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    set((state) => ({ projects: [...state.projects, newProject] }));
    get().saveData();
    return id;
  },

  updateProject: (id, updates) => {
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === id ? { ...project, ...updates, updatedAt: new Date() } : project
      ),
    }));
    get().saveData();
  },

  deleteProject: (id) => {
    set((state) => ({
      projects: state.projects.filter((project) => project.id !== id),
      selectedProject: state.selectedProject?.id === id ? null : state.selectedProject,
    }));
    get().saveData();
  },

  selectProject: (project) => set({ selectedProject: project }),

  archiveProject: (id) => {
    get().updateProject(id, { isArchived: true, status: 'archived' });
  },

  getProjectTasks: (projectId) => {
    return get().tasks.filter((task) => task.projectId === projectId);
  },

  // Categories
  categories: initialCategories,
  selectedCategory: null,

  addCategory: (category) => {
    const id = generateId();
    const newCategory: Category = {
      ...category,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    set((state) => ({ categories: [...state.categories, newCategory] }));
    get().saveData();
    return id;
  },

  updateCategory: (id, updates) => {
    set((state) => ({
      categories: state.categories.map((category) =>
        category.id === id ? { ...category, ...updates, updatedAt: new Date() } : category
      ),
    }));
    get().saveData();
  },

  deleteCategory: (id) => {
    set((state) => ({
      categories: state.categories.filter((category) => category.id !== id),
      selectedCategory: state.selectedCategory === id ? null : state.selectedCategory,
    }));
    get().saveData();
  },

  setSelectedCategory: (id) => set({ selectedCategory: id }),

  reorderCategories: (categories) => {
    set({ categories: categories.map((cat, index) => ({ ...cat, order: index })) });
    get().saveData();
  },

  reorderTasks: (orderedTasks) => {
    const allTasks = get().tasks;
    const map = new Map(orderedTasks.map((t, idx) => [t.id, idx]));
    const next = allTasks.map((t) => {
      const newOrder = map.get(t.id);
      if (newOrder !== undefined) return { ...t, order: newOrder };
      return t;
    });
    set({ tasks: next });
    get().saveData();
  },

  // Tags
  tags: initialTags,

  addTag: (tag) => {
    const id = generateId();
    const newTag: Tag = {
      ...tag,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    set((state) => ({ tags: [...state.tags, newTag] }));
    get().saveData();
    return id;
  },

  updateTag: (id, updates) => {
    set((state) => ({
      tags: state.tags.map((tag) =>
        tag.id === id ? { ...tag, ...updates, updatedAt: new Date() } : tag
      ),
    }));
    get().saveData();
  },

  deleteTag: (id) => {
    set((state) => ({
      tags: state.tags.filter((tag) => tag.id !== id),
    }));
    get().saveData();
  },

  mergeTags: (sourceId, targetId) => {
    const tasks = get().tasks;
    tasks.forEach((task) => {
      if (task.tags.includes(sourceId)) {
        const newTags = task.tags.filter((t) => t !== sourceId);
        if (!newTags.includes(targetId)) {
          newTags.push(targetId);
        }
        get().updateTask(task.id, { tags: newTags });
      }
    });
    get().deleteTag(sourceId);
  },

  // Views
  views: defaultViews,
  activeView: defaultViews[0],

  addView: (view) => {
    const id = generateId();
    const newView: View = {
      ...view,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    set((state) => ({ views: [...state.views, newView] }));
    get().saveData();
    return id;
  },

  updateView: (id, updates) => {
    set((state) => ({
      views: state.views.map((view) =>
        view.id === id ? { ...view, ...updates, updatedAt: new Date() } : view
      ),
    }));
    get().saveData();
  },

  deleteView: (id) => {
    set((state) => ({
      views: state.views.filter((view) => view.id !== id),
      activeView: state.activeView?.id === id ? null : state.activeView,
    }));
    get().saveData();
  },

  setActiveView: (view) => set({ activeView: view }),

  setDefaultViews: () => {
    set({ views: defaultViews, activeView: defaultViews[0] });
  },

  // Calendar
  calendars: [],
  events: [],
  selectedDate: new Date(),
  calendarViewType: 'month',

  addCalendar: (calendar) => {
    const id = generateId();
    const newCalendar: Calendar = {
      ...calendar,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    set((state) => ({ calendars: [...state.calendars, newCalendar] }));
    get().saveData();
    return id;
  },

  updateCalendar: (id, updates) => {
    set((state) => ({
      calendars: state.calendars.map((calendar) =>
        calendar.id === id ? { ...calendar, ...updates, updatedAt: new Date() } : calendar
      ),
    }));
    get().saveData();
  },

  deleteCalendar: (id) => {
    set((state) => ({
      calendars: state.calendars.filter((calendar) => calendar.id !== id),
    }));
    get().saveData();
  },

  addEvent: (event) => {
    const id = generateId();
    const newEvent: CalendarEvent = {
      ...event,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    set((state) => ({ events: [...state.events, newEvent] }));
    get().saveData();
    return id;
  },

  updateEvent: (id, updates) => {
    set((state) => ({
      events: state.events.map((event) =>
        event.id === id ? { ...event, ...updates, updatedAt: new Date() } : event
      ),
    }));
    get().saveData();
  },

  deleteEvent: (id) => {
    set((state) => ({
      events: state.events.filter((event) => event.id !== id),
    }));
    get().saveData();
  },

  setSelectedDate: (date) => set({ selectedDate: date }),

  setCalendarViewType: (type) => set({ calendarViewType: type }),

  getEventsForDate: (date) => {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return get().events.filter((event) => {
      const eventStart = new Date(event.startDate);
      return eventStart >= startOfDay && eventStart <= endOfDay;
    });
  },

  getEventsForRange: (start, end) => {
    return get().events.filter((event) => {
      const eventStart = new Date(event.startDate);
      return eventStart >= start && eventStart <= end;
    });
  },

  // Reminders
  reminders: [],

  addReminder: (reminder) => {
    const id = generateId();
    const newReminder: Reminder = {
      ...reminder,
      id,
      createdAt: new Date(),
    };
    set((state) => ({ reminders: [...state.reminders, newReminder] }));
    get().saveData();
    return id;
  },

  updateReminder: (id, updates) => {
    set((state) => ({
      reminders: state.reminders.map((reminder) =>
        reminder.id === id ? { ...reminder, ...updates } : reminder
      ),
    }));
    get().saveData();
  },

  deleteReminder: (id) => {
    set((state) => ({
      reminders: state.reminders.filter((reminder) => reminder.id !== id),
    }));
    get().saveData();
  },

  snoozeReminder: (id, minutes) => {
    const reminder = get().reminders.find((r) => r.id === id);
    if (reminder) {
      const snoozeUntil = new Date();
      snoozeUntil.setMinutes(snoozeUntil.getMinutes() + minutes);
      get().updateReminder(id, {
        snoozeCount: reminder.snoozeCount + 1,
        lastSnoozeDate: new Date(),
        customTime: snoozeUntil,
      });
    }
  },

  // Goals
  goals: [],
  selectedGoal: null,

  addGoal: (goal) => {
    const id = generateId();
    const newGoal: Goal = {
      ...goal,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    set((state) => ({ goals: [...state.goals, newGoal] }));
    get().saveData();
    return id;
  },

  updateGoal: (id, updates) => {
    set((state) => ({
      goals: state.goals.map((goal) =>
        goal.id === id ? { ...goal, ...updates, updatedAt: new Date() } : goal
      ),
    }));
    get().saveData();
  },

  deleteGoal: (id) => {
    set((state) => ({
      goals: state.goals.filter((goal) => goal.id !== id),
      selectedGoal: state.selectedGoal?.id === id ? null : state.selectedGoal,
    }));
    get().saveData();
  },

  selectGoal: (goal) => set({ selectedGoal: goal }),

  progressGoal: (id, value) => {
    const goal = get().goals.find((g) => g.id === id);
    if (goal) {
      const newValue = goal.currentValue + value;
      const progress = Math.min((newValue / goal.targetValue) * 100, 100);
      get().updateGoal(id, {
        currentValue: newValue,
        progress,
        isCompleted: progress >= 100,
        completedAt: progress >= 100 ? new Date() : null,
      });
    }
  },

  completeGoal: (id) => {
    const goal = get().goals.find((g) => g.id === id);
    if (goal) {
      get().updateGoal(id, {
        currentValue: goal.targetValue,
        progress: 100,
        isCompleted: true,
        completedAt: new Date(),
      });
    }
  },

  // Habits
  habits: [],
  selectedHabit: null,

  addHabit: (habit) => {
    const id = generateId();
    const newHabit: Habit = {
      ...habit,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    set((state) => ({ habits: [...state.habits, newHabit] }));
    get().saveData();
    return id;
  },

  updateHabit: (id, updates) => {
    set((state) => ({
      habits: state.habits.map((habit) =>
        habit.id === id ? { ...habit, ...updates, updatedAt: new Date() } : habit
      ),
    }));
    get().saveData();
  },

  deleteHabit: (id) => {
    set((state) => ({
      habits: state.habits.filter((habit) => habit.id !== id),
      selectedHabit: state.selectedHabit?.id === id ? null : state.selectedHabit,
    }));
    get().saveData();
  },

  selectHabit: (habit) => set({ selectedHabit: habit }),

  completeHabit: (id, date) => {
    const habit = get().habits.find((h) => h.id === id);
    if (habit) {
      const newHistory = { ...habit.completionHistory, [date]: true };
      const streak = get().getHabitStreak(id) + 1;
      get().updateHabit(id, {
        completionHistory: newHistory,
        streak,
        bestStreak: Math.max(habit.bestStreak, streak),
        totalCompletions: habit.totalCompletions + 1,
      });
    }
  },

  uncompleteHabit: (id, date) => {
    const habit = get().habits.find((h) => h.id === id);
    if (habit) {
      const newHistory = { ...habit.completionHistory };
      delete newHistory[date];
      get().updateHabit(id, {
        completionHistory: newHistory,
        totalCompletions: Math.max(0, habit.totalCompletions - 1),
      });
    }
  },

  getHabitStreak: (id) => {
    const habit = get().habits.find((h) => h.id === id);
    if (!habit) return 0;

    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      if (habit.completionHistory[dateStr]) {
        streak++;
      } else if (i > 0) {
        break;
      }
    }
    return streak;
  },

  // Notes
  notes: [],
  selectedNote: null,

  addNote: (note) => {
    const id = generateId();
    const newNote: Note = {
      ...note,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    set((state) => ({ notes: [...state.notes, newNote] }));
    get().saveData();
    return id;
  },

  updateNote: (id, updates) => {
    set((state) => ({
      notes: state.notes.map((note) =>
        note.id === id ? { ...note, ...updates, updatedAt: new Date() } : note
      ),
    }));
    get().saveData();
  },

  deleteNote: (id) => {
    set((state) => ({
      notes: state.notes.filter((note) => note.id !== id),
      selectedNote: state.selectedNote?.id === id ? null : state.selectedNote,
    }));
    get().saveData();
  },

  selectNote: (note) => set({ selectedNote: note }),

  archiveNote: (id) => {
    get().updateNote(id, { isArchived: true });
  },

  pinNote: (id) => {
    const note = get().notes.find((n) => n.id === id);
    if (note) {
      get().updateNote(id, { isPinned: !note.isPinned });
    }
  },

  // AI
  aiSuggestions: [],
  aiInsights: [],

  addAISuggestion: (suggestion) => {
    set((state) => ({ aiSuggestions: [...state.aiSuggestions, suggestion] }));
  },

  acceptAISuggestion: (id) => {
    set((state) => ({
      aiSuggestions: state.aiSuggestions.map((s) =>
        s.id === id ? { ...s, isAccepted: true } : s
      ),
    }));
  },

  dismissAISuggestion: (id) => {
    set((state) => ({
      aiSuggestions: state.aiSuggestions.map((s) =>
        s.id === id ? { ...s, isDismissed: true } : s
      ),
    }));
  },

  clearOldSuggestions: () => {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    set((state) => ({
      aiSuggestions: state.aiSuggestions.filter(
        (s) => !s.isDismissed && new Date(s.createdAt) > oneWeekAgo
      ),
    }));
  },

  // Analytics
  dashboardStats: null,

  calculateDashboardStats: () => {
    const tasks = get().tasks;
    const goals = get().goals;
    const habits = get().habits;
    const projects = get().projects;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const activeTasks = tasks.filter((t) => !t.isArchived && !t.isDeleted);
    const completedTasks = activeTasks.filter((t) => t.completed);
    const inProgressTasks = activeTasks.filter((t) => t.status === 'in-progress');
    const overdueTasks = activeTasks.filter(
      (t) => !t.completed && t.dueDate && new Date(t.dueDate) < today
    );
    const upcomingTasks = activeTasks.filter(
      (t) =>
        !t.completed &&
        t.dueDate &&
        new Date(t.dueDate) >= today &&
        new Date(t.dueDate) <= tomorrow
    );
    const todayTasks = activeTasks.filter((t) => {
      if (!t.dueDate) return false;
      const dueDate = new Date(t.dueDate);
      return dueDate >= today && dueDate < tomorrow;
    });

    const stats: DashboardStats = {
      overview: {
        totalTasks: activeTasks.length,
        completedTasks: completedTasks.length,
        inProgressTasks: inProgressTasks.length,
        overdueTasks: overdueTasks.length,
        upcomingTasks: upcomingTasks.length,
        todayTasks: todayTasks.length,
        completionRate: activeTasks.length > 0 ? (completedTasks.length / activeTasks.length) * 100 : 0,
        averageCompletionTime: 0,
        streak: 0,
        bestStreak: 0,
        totalProjects: projects.length,
        activeProjects: projects.filter((p) => p.status === 'active').length,
        totalHabits: habits.length,
        habitsCompletedToday: habits.filter((h) => h.completionHistory[today.toISOString().split('T')[0]]).length,
      },
      productivity: {
        daily: [],
        weekly: [],
        monthly: [],
        yearly: [],
        bestDay: { day: 0, score: 0 },
        bestWeek: { week: 0, score: 0 },
        productivityScore: 0,
        focusScore: 0,
        consistencyScore: 0,
      },
      trends: [],
      categories: [],
      timeUsage: {
        byDay: {},
        byHour: {},
        byCategory: {},
        byProject: {},
        byPriority: {},
      },
      goals: goals.map((g) => ({
        id: g.id,
        name: g.title,
        type: g.type,
        target: g.targetValue,
        current: g.currentValue,
        period: 'daily' as const,
        startDate: g.startDate,
        endDate: g.endDate,
        isCompleted: g.isCompleted,
        progress: g.progress,
        daysRemaining: Math.ceil((new Date(g.endDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
      })),
      habits: habits.map((h) => ({
        id: h.id,
        name: h.name,
        currentStreak: h.streak,
        bestStreak: h.bestStreak,
        completionRate: 0,
        totalCompletions: h.totalCompletions,
        averageDuration: h.averageDuration,
      })),
    };

    set({ dashboardStats: stats });
  },

  getTaskStats: (taskIds) => {
    const tasks = get().tasks.filter((t) => taskIds.includes(t.id));
    return {
      total: tasks.length,
      completed: tasks.filter((t) => t.completed).length,
      inProgress: tasks.filter((t) => t.status === 'in-progress').length,
      overdue: tasks.filter((t) => !t.completed && t.dueDate && new Date(t.dueDate) < new Date()).length,
    };
  },

  getProductivityScore: () => {
    const tasks = get().tasks.filter((t) => !t.isArchived && !t.isDeleted);
    const completed = tasks.filter((t) => t.completed);
    const onTime = completed.filter((t) => {
      if (!t.completedAt || !t.dueDate) return false;
      return new Date(t.completedAt) <= new Date(t.dueDate);
    });

    if (completed.length === 0) return 0;
    return Math.round((onTime.length / completed.length) * 100);
  },

  getCompletionRate: () => {
    const tasks = get().tasks.filter((t) => !t.isArchived && !t.isDeleted);
    const completed = tasks.filter((t) => t.completed);
    if (tasks.length === 0) return 0;
    return Math.round((completed.length / tasks.length) * 100);
  },

  getStreak: () => {
    const habits = get().habits;
    if (habits.length === 0) return 0;
    return Math.min(...habits.map((h) => h.streak));
  },

  // UI State
  theme: defaultTheme,
  sidebarOpen: true,
  activeModal: null,
  activeTab: 'tasks',
  searchQuery: '',
  isSearchOpen: false,
  notifications: [],
  unreadNotificationCount: 0,

  setTheme: (theme) => {
    if ('type' in theme && theme.type === 'dark') {
      set({ theme: darkTheme });
      get().saveData();
    } else if ('type' in theme && theme.type === 'light') {
      set({ theme: defaultTheme });
      get().saveData();
    } else if ('type' in theme && theme.type === 'system') {
      set({ theme: defaultTheme });
      get().saveData();
    } else {
      set({ theme: { ...get().theme, ...(theme as Partial<ThemePreset>) } as ThemePreset });
      get().saveData();
    }
  },

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarOpen: (open) => {
    set({ sidebarOpen: open });
    get().saveData();
  },

  userPreferences: {
    defaultView: 'list' as const,
    defaultProject: null,
    defaultCategory: null,
    startDayOfWeek: 1,
    workHours: {
      enabled: false,
      startHour: 9,
      endHour: 18,
      days: [1, 2, 3, 4, 5],
      timezone: 'Asia/Shanghai',
    },
    notifications: {
      taskReminders: true,
      projectUpdates: true,
      comments: true,
      mentions: true,
      dailyDigest: true,
      weeklyReport: false,
      teamUpdates: true,
      soundEnabled: true,
      vibrationEnabled: true,
      badgeEnabled: true,
      quietHours: {
        enabled: false,
        startTime: '22:00',
        endTime: '08:00',
        days: [0, 1, 2, 3, 4, 5, 6],
        timezone: 'Asia/Shanghai',
      },
      quietHoursEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      notificationChannels: [],
    },
    integrations: {
      googleCalendar: false,
      appleCalendar: false,
      outlookCalendar: false,
      slack: false,
      teams: false,
      github: false,
      jira: false,
      notion: false,
      dropbox: false,
      onedrive: false,
      googleDrive: false,
    },
    shortcuts: {
      quickAdd: 'Ctrl+N',
      search: 'Ctrl+K',
      toggleSidebar: 'Ctrl+B',
      markComplete: 'Ctrl+Enter',
      newTask: 'Ctrl+T',
      newProject: 'Ctrl+P',
      settings: 'Ctrl+,',
      help: 'F1',
    },
    displaySettings: {
      compactMode: false,
      showAnimations: true,
      showTooltips: true,
      showAvatars: true,
      showTaskIcons: true,
      showCompletedTasks: true,
      showSubtasks: true,
      showAttachments: true,
      cardDensity: 'comfortable',
      colorScheme: 'light',
      accentColor: '#3B82F6',
      fontSize: 'medium',
      fontFamily: 'System',
      dateFormat: 'YYYY-MM-DD',
      timeFormat: '24h',
      firstDayOfWeek: 1,
    },
    privacySettings: {
      profileVisibility: 'private',
      showEmail: false,
      showPhone: false,
      showActivity: true,
      allowMentions: true,
      allowInvites: true,
      dataCollection: true,
      analytics: true,
      biometricLock: false,
      autoLockTimeout: 5,
    },
    languageSettings: {
      language: 'zh-CN',
      timezone: 'Asia/Shanghai',
      dateFormat: 'YYYY-MM-DD',
      timeFormat: '24h',
      firstDayOfWeek: 1,
      numberFormat: '1,000.00',
      currency: 'CNY',
    },
    accessibilitySettings: {
      screenReaderEnabled: false,
      highContrastMode: false,
      largeText: false,
      reduceMotion: false,
      colorBlindMode: false,
      keyboardNavigation: true,
      voiceControl: false,
      hapticFeedback: true,
    },
    pomodoroSettings: {
      enabled: true,
      focusDuration: 25,
      shortBreakDuration: 5,
      longBreakDuration: 15,
      longBreakInterval: 4,
      dailyGoal: 4,
      autoStartBreaks: false,
      autoStartFocus: false,
      soundEnabled: true,
      vibrationEnabled: true,
    },
  },

  updateUserPreferences: (prefs) => {
    set((state) => ({
      userPreferences: { ...state.userPreferences, ...prefs },
    }));
    get().saveData();
  },

  updateNotificationSettings: (notifications) => {
    set((state) => ({
      userPreferences: {
        ...state.userPreferences,
        notifications: { ...state.userPreferences.notifications, ...notifications },
      },
    }));
    get().saveData();
  },

  updateDisplaySettings: (displaySettings) => {
    set((state) => ({
      userPreferences: {
        ...state.userPreferences,
        displaySettings: { ...state.userPreferences.displaySettings, ...displaySettings },
      },
    }));
    get().saveData();
  },

  updatePrivacySettings: (privacySettings) => {
    set((state) => ({
      userPreferences: {
        ...state.userPreferences,
        privacySettings: { ...state.userPreferences.privacySettings, ...privacySettings },
      },
    }));
    get().saveData();
  },

  setActiveModal: (modal) => set({ activeModal: modal }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  toggleSearch: () => set((state) => ({ isSearchOpen: !state.isSearchOpen })),

  addNotification: (notification) => {
    set((state) => ({
      notifications: [notification, ...state.notifications],
      unreadNotificationCount: state.unreadNotificationCount + 1,
    }));
  },

  markNotificationRead: (id) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, isRead: true } : n
      ),
      unreadNotificationCount: Math.max(0, state.unreadNotificationCount - 1),
    }));
  },

  clearNotifications: () => set({ notifications: [], unreadNotificationCount: 0 }),

  // Automation
  automationRules: [],

  addAutomationRule: (rule) => {
    const id = generateId();
    const newRule: AutomationRule = {
      ...rule,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    set((state) => ({ automationRules: [...state.automationRules, newRule] }));
    get().saveData();
    return id;
  },

  updateAutomationRule: (id, updates) => {
    set((state) => ({
      automationRules: state.automationRules.map((rule) =>
        rule.id === id ? { ...rule, ...updates, updatedAt: new Date() } : rule
      ),
    }));
    get().saveData();
  },

  deleteAutomationRule: (id) => {
    set((state) => ({
      automationRules: state.automationRules.filter((rule) => rule.id !== id),
    }));
    get().saveData();
  },

  toggleAutomationRule: (id) => {
    const rule = get().automationRules.find((r) => r.id === id);
    if (rule) {
      get().updateAutomationRule(id, { isEnabled: !rule.isEnabled });
    }
  },

  executeAutomation: async (ruleId, _context) => {
    const rule = get().automationRules.find((r) => r.id === ruleId);
    if (!rule || !rule.isEnabled) return;

    try {
      // Execute actions based on rule
      rule.actions.forEach((_action) => {
        // Action execution logic would go here.
        // The shape of `action` is intentionally left to product requirements;
        // intentionally NOT logging to avoid noisy devtools in production builds.
      });

      get().updateAutomationRule(ruleId, {
        executionCount: rule.executionCount + 1,
        lastExecutedAt: new Date(),
      });
    } catch (error) {
      get().updateAutomationRule(ruleId, {
        lastError: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },

  // Templates
  templates: [],

  addTemplate: (template) => {
    const id = generateId();
    const newTemplate: Template = {
      ...template,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    set((state) => ({ templates: [...state.templates, newTemplate] }));
    get().saveData();
    return id;
  },

  updateTemplate: (id, updates) => {
    set((state) => ({
      templates: state.templates.map((template) =>
        template.id === id ? { ...template, ...updates, updatedAt: new Date() } : template
      ),
    }));
    get().saveData();
  },

  deleteTemplate: (id) => {
    set((state) => ({
      templates: state.templates.filter((template) => template.id !== id),
    }));
    get().saveData();
  },

  applyTemplate: (templateId, variables = {}) => {
    const template = get().templates.find((t) => t.id === templateId);
    if (!template) return null;

    let content = deepClone(template.content);
    Object.entries(variables).forEach(([key, value]) => {
      content = JSON.parse(JSON.stringify(content).replace(new RegExp(`{{${key}}}`, 'g'), String(value)));
    });

    return content;
  },

  // Teams
  teams: [],
  currentTeam: null,
  activities: [],

  addTeam: (team) => {
    const id = generateId();
    const newTeam: Team = {
      ...team,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    set((state) => ({ teams: [...state.teams, newTeam] }));
    get().saveData();
    return id;
  },

  updateTeam: (id, updates) => {
    set((state) => ({
      teams: state.teams.map((team) =>
        team.id === id ? { ...team, ...updates, updatedAt: new Date() } : team
      ),
    }));
    get().saveData();
  },

  deleteTeam: (id) => {
    set((state) => ({
      teams: state.teams.filter((team) => team.id !== id),
      currentTeam: state.currentTeam?.id === id ? null : state.currentTeam,
    }));
    get().saveData();
  },

  setCurrentTeam: (team) => set({ currentTeam: team }),

  addTeamMember: (teamId, member) => {
    const team = get().teams.find((t) => t.id === teamId);
    if (team) {
      get().updateTeam(teamId, {
        members: [...team.members, { ...member, id: generateId(), joinedAt: new Date() }],
      });
    }
  },

  removeTeamMember: (teamId, memberId) => {
    const team = get().teams.find((t) => t.id === teamId);
    if (team) {
      get().updateTeam(teamId, {
        members: team.members.filter((m) => m.id !== memberId),
      });
    }
  },

  updateTeamMember: (teamId, memberId, updates) => {
    const team = get().teams.find((t) => t.id === teamId);
    if (team) {
      get().updateTeam(teamId, {
        members: team.members.map((m) => (m.id === memberId ? { ...m, ...updates } : m)),
      });
    }
  },

  addActivity: (activity) => {
    const newActivity: Activity = {
      ...activity,
      id: generateId(),
      createdAt: new Date(),
    };
    set((state) => ({ activities: [newActivity, ...state.activities].slice(0, 100) }));
    get().saveData();
  },

  // Sync & Backup
  syncConfig: {
    enabled: false,
    provider: 'expo',
    syncInterval: 15,
    lastSyncAt: null,
    syncStatus: 'idle',
    conflictStrategy: 'merge',
    autoSync: false,
    syncOnStart: false,
    syncOnEdit: false,
    wifiOnly: false,
    credentials: null,
  },
  lastSyncAt: null,
  isSyncing: false,

  setSyncConfig: (config) => {
    set({ syncConfig: config });
    get().saveData();
  },

  performSync: async () => {
    if (get().isSyncing) return;
    set({ isSyncing: true });
    try {
      // Simulate sync - actual implementation would connect to cloud provider
      await new Promise((resolve) => setTimeout(resolve, 2000));
      set({ lastSyncAt: new Date(), isSyncing: false });
      get().saveData();
    } catch (error) {
      set({ isSyncing: false });
      throw error;
    }
  },

  setLastSyncAt: (date) => set({ lastSyncAt: date }),

  // Persistence
  loadData: async () => {
    try {
      const [
        tasksData, projectsData, categoriesData, tagsData, viewsData,
        themeData, goalsData, habitsData, notesData, calendarsData,
        eventsData, remindersData, automationData, templatesData, teamsData,
        sessionsData,
      ] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.TASKS),
        AsyncStorage.getItem(STORAGE_KEYS.PROJECTS),
        AsyncStorage.getItem(STORAGE_KEYS.CATEGORIES),
        AsyncStorage.getItem(STORAGE_KEYS.TAGS),
        AsyncStorage.getItem(STORAGE_KEYS.VIEWS),
        AsyncStorage.getItem(STORAGE_KEYS.THEME),
        AsyncStorage.getItem(STORAGE_KEYS.GOALS),
        AsyncStorage.getItem(STORAGE_KEYS.HABITS),
        AsyncStorage.getItem(STORAGE_KEYS.NOTES),
        AsyncStorage.getItem(STORAGE_KEYS.CALENDARS),
        AsyncStorage.getItem(STORAGE_KEYS.EVENTS),
        AsyncStorage.getItem(STORAGE_KEYS.REMINDERS),
        AsyncStorage.getItem(STORAGE_KEYS.AUTOMATION),
        AsyncStorage.getItem(STORAGE_KEYS.TEMPLATES),
        AsyncStorage.getItem(STORAGE_KEYS.TEAMS),
        AsyncStorage.getItem(STORAGE_KEYS.SESSIONS),
      ]);

      const parseDates = (data: any) => ({
        ...data,
        createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
        updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(),
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        completedAt: data.completedAt ? new Date(data.completedAt) : null,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
      });

      if (tasksData) {
        const tasks = JSON.parse(tasksData).map(parseDates);
        set({ tasks });
      }
      if (projectsData) {
        const projects = JSON.parse(projectsData).map(parseDates);
        set({ projects });
      }
      if (categoriesData) {
        const categories = JSON.parse(categoriesData).map(parseDates);
        if (categories.length > 0) set({ categories });
      }
      if (tagsData) {
        const tags = JSON.parse(tagsData).map(parseDates);
        if (tags.length > 0) set({ tags });
      }
      if (viewsData) {
        const views = JSON.parse(viewsData).map(parseDates);
        if (views.length > 0) {
          set({ views, activeView: views[0] });
        }
      }
      if (themeData) {
        const theme = JSON.parse(themeData);
        set({ theme });
      }
      if (goalsData) {
        const goals = JSON.parse(goalsData).map(parseDates);
        if (goals.length > 0) set({ goals });
      }
      if (habitsData) {
        const habits = JSON.parse(habitsData).map(parseDates);
        if (habits.length > 0) set({ habits });
      }
      if (notesData) {
        const notes = JSON.parse(notesData).map(parseDates);
        if (notes.length > 0) set({ notes });
      }
      if (calendarsData) {
        const calendars = JSON.parse(calendarsData).map(parseDates);
        if (calendars.length > 0) set({ calendars });
      }
      if (eventsData) {
        const events = JSON.parse(eventsData).map(parseDates);
        if (events.length > 0) set({ events });
      }
      if (remindersData) {
        const reminders = JSON.parse(remindersData).map(parseDates);
        if (reminders.length > 0) set({ reminders });
      }
      if (automationData) {
        const automationRules = JSON.parse(automationData).map(parseDates);
        if (automationRules.length > 0) set({ automationRules });
      }
      if (templatesData) {
        const templates = JSON.parse(templatesData).map(parseDates);
        if (templates.length > 0) set({ templates });
      }
      if (teamsData) {
        const teams = JSON.parse(teamsData).map(parseDates);
        if (teams.length > 0) set({ teams });
      }
      if (sessionsData) {
        const sessions = JSON.parse(sessionsData).map((s: any) => ({
          ...s,
          startedAt: s.startedAt ? new Date(s.startedAt) : new Date(),
        }));
        if (sessions.length > 0) set({ sessions });
      }

      const userPrefsData = await AsyncStorage.getItem(STORAGE_KEYS.USER_PREFERENCES);
      if (userPrefsData) {
        set({ userPreferences: JSON.parse(userPrefsData) });
      }

      const sidebarData = await AsyncStorage.getItem(STORAGE_KEYS.SIDEBAR_OPEN);
      if (sidebarData) {
        set({ sidebarOpen: JSON.parse(sidebarData) });
      }

      const searchHistoryData = await AsyncStorage.getItem(STORAGE_KEYS.SEARCH_HISTORY);
      if (searchHistoryData) {
        set({ searchHistory: JSON.parse(searchHistoryData) });
      }
    } catch (error) {
      console.error('Error loading data:', error);
    }
  },

  saveData: async () => {
    try {
      const state = get();
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(state.tasks)),
        AsyncStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(state.projects)),
        AsyncStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(state.categories)),
        AsyncStorage.setItem(STORAGE_KEYS.TAGS, JSON.stringify(state.tags)),
        AsyncStorage.setItem(STORAGE_KEYS.VIEWS, JSON.stringify(state.views)),
        AsyncStorage.setItem(STORAGE_KEYS.THEME, JSON.stringify(state.theme)),
        AsyncStorage.setItem(STORAGE_KEYS.GOALS, JSON.stringify(state.goals)),
        AsyncStorage.setItem(STORAGE_KEYS.HABITS, JSON.stringify(state.habits)),
        AsyncStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(state.notes)),
        AsyncStorage.setItem(STORAGE_KEYS.CALENDARS, JSON.stringify(state.calendars)),
        AsyncStorage.setItem(STORAGE_KEYS.EVENTS, JSON.stringify(state.events)),
        AsyncStorage.setItem(STORAGE_KEYS.REMINDERS, JSON.stringify(state.reminders)),
        AsyncStorage.setItem(STORAGE_KEYS.AUTOMATION, JSON.stringify(state.automationRules)),
        AsyncStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(state.templates)),
        AsyncStorage.setItem(STORAGE_KEYS.TEAMS, JSON.stringify(state.teams)),
        AsyncStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(state.sessions || [])),
        AsyncStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, JSON.stringify(state.userPreferences)),
        AsyncStorage.setItem(STORAGE_KEYS.SIDEBAR_OPEN, JSON.stringify(state.sidebarOpen)),
        AsyncStorage.setItem(STORAGE_KEYS.SEARCH_HISTORY, JSON.stringify(state.searchHistory)),
        AsyncStorage.setItem(STORAGE_KEYS.SYNC_CONFIG, JSON.stringify(state.syncConfig)),
      ]);
    } catch (error) {
      console.error('Error saving data:', error);
    }
  },

  exportData: async () => {
    const state = get();
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      tasks: state.tasks,
      projects: state.projects,
      categories: state.categories,
      tags: state.tags,
      views: state.views,
      goals: state.goals,
      habits: state.habits,
      notes: state.notes,
      settings: {
        theme: state.theme,
        syncConfig: state.syncConfig,
      },
    };
    return JSON.stringify(exportData, null, 2);
  },

  importData: async (data: string) => {
    try {
      const importData = JSON.parse(data);
      if (importData.tasks) {
        set({ tasks: importData.tasks.map((t: any) => ({
          ...t,
          createdAt: new Date(t.createdAt),
          updatedAt: new Date(t.updatedAt),
        })) });
      }
      if (importData.projects) {
        set({ projects: importData.projects.map((p: any) => ({
          ...p,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
        })) });
      }
      if (importData.categories) {
        set({ categories: importData.categories.map((c: any) => ({
          ...c,
          createdAt: new Date(c.createdAt),
          updatedAt: new Date(c.updatedAt),
        })) });
      }
      if (importData.tags) {
        set({ tags: importData.tags.map((t: any) => ({
          ...t,
          createdAt: new Date(t.createdAt),
          updatedAt: new Date(t.updatedAt),
        })) });
      }
      if (importData.views) {
        set({ views: importData.views.map((v: any) => ({
          ...v,
          createdAt: new Date(v.createdAt),
          updatedAt: new Date(v.updatedAt),
        })) });
      }
      if (importData.goals) set({ goals: importData.goals });
      if (importData.habits) set({ habits: importData.habits });
      if (importData.notes) set({ notes: importData.notes });
      if (importData.settings?.theme) set({ theme: importData.settings.theme });

      get().saveData();
    } catch (error) {
      console.error('Error importing data:', error);
      throw error;
    }
  },

  resetData: () => {
    set({
      tasks: [],
      projects: [],
      categories: initialCategories,
      tags: initialTags,
      views: defaultViews,
      activeView: defaultViews[0],
      goals: [],
      habits: [],
      notes: [],
      teams: [],
      activities: [],
      automationRules: [],
      templates: [],
      dashboardStats: null,
      selectedTask: null,
      selectedProject: null,
      selectedGoal: null,
      selectedHabit: null,
      selectedNote: null,
      currentTeam: null,
      searchHistory: [],
    });
    get().saveData();
  },
}));
