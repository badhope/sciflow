import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Modal,
  Platform,
} from 'react-native';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppStore } from '../src/shared/store';
import {
  SwipeableTaskCard,
  EmptyState,
  MultiSelectBar,
  type MultiSelectAction,
  toast,
  FocusMode,
  DraggableList,
  TaskSuggestions,
  type TaskSuggestion,
  SideDrawer,
  type DrawerItem,
  CollapsibleSection,
} from '../src/shared/components/common';
import { useBulkSelection } from '../src/shared/hooks/useBulkSelection';
import { undoDeleteTask } from '../src/shared/hooks/useUndo';
import { HomeStackParamList, Task } from '../src/shared/types';

type NavigationProp = NativeStackNavigationProp<HomeStackParamList, 'Home'>;

export default function HomeScreen() {
  const navigation = useNavigation<NavigationProp>();
  const {
    theme,
    tasks,
    categories,
    activeView,
    selectedCategory,
    setSelectedCategory,
    loadData,
    toggleTaskComplete,
    deleteTask,
    updateTask,
    sortTasks,
    reorderTasks,
  } = useAppStore();

  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFocus, setShowFocus] = useState(false);
  const [focusTaskTitle, setFocusTaskTitle] = useState<string | undefined>(undefined);
  const [showReorder, setShowReorder] = useState(false);
  const [reorderList, setReorderList] = useState<Task[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    // Load once on mount; loadData is stable from the store and we don't
    // want to refetch on every store change (would re-render the list).
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const filteredTasks = useMemo(() => tasks
    .filter((task) => !task.isArchived && !task.isDeleted)
    .filter((task) => {
      if (selectedCategory) {
        return task.categoryId === selectedCategory;
      }
      return true;
    })
    .filter((task) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          task.title.toLowerCase().includes(query) ||
          task.description.toLowerCase().includes(query)
        );
      }
      return true;
    }), [tasks, selectedCategory, searchQuery]);

  const sortedTasks = useMemo(() => activeView?.sortOptions?.length
    ? sortTasks(filteredTasks, activeView.sortOptions)
    : filteredTasks, [filteredTasks, activeView, sortTasks]);

  const pendingCount = tasks.filter((t) => !t.isArchived && !t.isDeleted && !t.completed).length;
  const completedCount = tasks.filter((t) => !t.isArchived && !t.isDeleted && t.completed).length;

  const bulk = useBulkSelection(sortedTasks);

  const handleBulkComplete = () => {
    bulk.selectedItems.forEach((t) => toggleTaskComplete(t.id));
    toast.success(`已标记 ${bulk.count} 个任务完成`);
    bulk.exit();
  };

  const handleBulkDelete = () => {
    const deleted = [...bulk.selectedItems];
    bulk.selectedItems.forEach((t) => deleteTask(t.id));
    toast.withAction(`已删除 ${deleted.length} 个任务`, '撤销', () => {
      deleted.reverse().forEach((t) => undoDeleteTask(t));
      toast.success('已恢复');
    });
    bulk.exit();
  };

  const handleBulkArchive = () => {
    bulk.selectedItems.forEach((t) => updateTask(t.id, { isArchived: true }));
    toast.success(`已归档 ${bulk.count} 个任务`);
    bulk.exit();
  };

  const handleBulkPriority = (priority: string) => {
    bulk.selectedItems.forEach((t) => updateTask(t.id, { priority: priority as any }));
    toast.success(`已更新 ${bulk.count} 个任务优先级`);
    bulk.exit();
  };

  const openReorder = useCallback(() => {
    setReorderList([...sortedTasks]);
    setShowReorder(true);
  }, [sortedTasks]);

  const handleReorder = (from: number, to: number) => {
    setReorderList((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  };

  const saveReorder = () => {
    reorderTasks(reorderList);
    setShowReorder(false);
    toast.success('任务顺序已保存');
  };

  const handleApplySuggestion = (s: TaskSuggestion) => {
    if (s.kind === 'priority' && s.payload?.taskId) {
      updateTask(s.payload.taskId, { priority: s.payload.priority });
      toast.success('已应用优先级建议');
    } else if (s.kind === 'category' && s.payload?.categoryId) {
      setSelectedCategory(s.payload.categoryId);
      toast.success('已切换到建议分类');
    } else if (s.kind === 'merge' && s.payload) {
      updateTask(s.payload.keep, { isArchived: false });
      deleteTask(s.payload.remove);
      toast.withAction?.('已合并相似任务', '撤销', () => {
        undoDeleteTask({ id: s.payload.remove } as Task);
        toast.success('已恢复');
      });
    } else {
      toast.info('已记录建议');
    }
  };

  const renderTask = useCallback(({ item }: { item: Task }) => {
    if (bulk.active) {
      const selected = bulk.isSelected(item.id);
      return (
        <TouchableOpacity
          onPress={() => bulk.toggle(item.id)}
          onLongPress={() => bulk.exit()}
          activeOpacity={0.7}
          style={[
            {
              flexDirection: 'row',
              alignItems: 'center',
              padding: 12,
              backgroundColor: selected ? theme.colors.primary + '14' : theme.colors.card,
              borderRadius: 12,
              marginHorizontal: 16,
              marginVertical: 4,
              borderWidth: selected ? 1.5 : 1,
              borderColor: selected ? theme.colors.primary : theme.colors.border,
            },
          ]}
        >
          <MaterialIcons
            name={selected ? 'check-box' : 'check-box-outline-blank'}
            size={24}
            color={selected ? theme.colors.primary : theme.colors.textTertiary}
          />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: theme.colors.text }}>
              {item.title}
            </Text>
            {item.dueDate && (
              <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>
                {new Date(item.dueDate).toLocaleDateString()}
              </Text>
            )}
          </View>
        </TouchableOpacity>
      );
    }
    return (
      <SwipeableTaskCard
        task={item}
        onPress={() => navigation.navigate('TaskDetail', { taskId: item.id })}
        onLongPress={() => bulk.enter()}
        onToggleComplete={() => toggleTaskComplete(item.id)}
        onSwipeLeft={(task) => {
          deleteTask(task.id);
          toast.withAction('任务已删除', '撤销', () => {
            undoDeleteTask(task);
            toast.success('已恢复');
          });
        }}
        onSwipeRight={(task) => toggleTaskComplete(task.id)}
      />
    );
  }, [navigation, toggleTaskComplete, deleteTask, bulk, theme]);

  const bulkActions: MultiSelectAction[] = [
    {
      icon: 'check-circle',
      label: '完成',
      onPress: handleBulkComplete,
      color: 'success',
    },
    {
      icon: 'archive',
      label: '归档',
      onPress: handleBulkArchive,
      color: 'warning',
    },
    {
      icon: 'priority-high',
      label: '优先级',
      onPress: () => {
        const priorities: ('low' | 'medium' | 'high' | 'urgent')[] = ['low', 'medium', 'high', 'urgent'];
        const next = priorities[(priorities.indexOf('medium') + 1) % priorities.length];
        handleBulkPriority(next);
      },
      color: 'primary',
    },
    {
      icon: 'delete',
      label: '删除',
      onPress: handleBulkDelete,
      destructive: true,
    },
  ];

  const renderHeader = useCallback(() => (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <View style={styles.headerTitleWrap}>
          <Text style={[styles.greeting, { color: theme.colors.textSecondary }]}>
            欢迎回来 👋
          </Text>
          <Text style={[styles.title, { color: theme.colors.text }]}>TaskFlow <Text style={[styles.versionBadge, { color: theme.colors.primary, backgroundColor: theme.colors.primary + '14' }]}>v1.1.0 · web</Text></Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            onPress={() => setDrawerOpen(true)}
            activeOpacity={0.7}
            accessibilityLabel="打开导航抽屉"
            accessibilityRole="button"
          >
            <MaterialIcons name="menu" size={20} color={theme.colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            onPress={() => navigation.navigate('Settings')}
            activeOpacity={0.7}
            accessibilityLabel="设置"
          >
            <MaterialIcons name="settings" size={20} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.searchBar, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <MaterialIcons name="search" size={18} color={theme.colors.textTertiary} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: theme.colors.text }]}
          placeholder="搜索任务、项目、标签..."
          placeholderTextColor={theme.colors.textTertiary}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={18} color={theme.colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  ), [theme, searchQuery, navigation]);

  const renderStats = useCallback(() => {
    if (pendingCount === 0 && completedCount === 0) return null;
    const completionPercent = pendingCount + completedCount > 0
      ? Math.round((completedCount / (pendingCount + completedCount)) * 100)
      : 0;
    return (
      <CollapsibleSection
        title="今日概览"
        subtitle={`${pendingCount} 待办 · ${completedCount} 已完成 · ${completionPercent}% 完成率`}
        icon="insights"
        iconColor={theme.colors.primary}
        defaultExpanded={false}
        theme={theme}
        compact
      >
        <View style={styles.statsRow}>
          <TouchableOpacity
            style={[styles.statCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            activeOpacity={0.85}
          >
            <View style={[styles.statIconWrap, { backgroundColor: theme.colors.primary + '14' }]}>
              <MaterialIcons name="schedule" size={18} color={theme.colors.primary} />
            </View>
            <View style={styles.statTextWrap}>
              <Text style={[styles.statNumber, { color: theme.colors.text }]}>{pendingCount}</Text>
              <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>待完成</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.statCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            activeOpacity={0.85}
          >
            <View style={[styles.statIconWrap, { backgroundColor: theme.colors.success + '14' }]}>
              <MaterialIcons name="check-circle" size={18} color={theme.colors.success} />
            </View>
            <View style={styles.statTextWrap}>
              <Text style={[styles.statNumber, { color: theme.colors.text }]}>{completedCount}</Text>
              <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>已完成</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.statCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            onPress={() => navigation.navigate('Analytics')}
            activeOpacity={0.85}
          >
            <View style={[styles.statIconWrap, { backgroundColor: theme.colors.accent + '14' }]}>
              <Ionicons name="stats-chart" size={18} color={theme.colors.accent} />
            </View>
            <View style={styles.statTextWrap}>
              <Text style={[styles.statNumber, { color: theme.colors.text }]}>{completionPercent}<Text style={styles.statPercent}>%</Text></Text>
              <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>完成率</Text>
            </View>
          </TouchableOpacity>
        </View>
      </CollapsibleSection>
    );
  }, [pendingCount, completedCount, theme, navigation]);

  const renderCategories = useCallback(() => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
    >
      <TouchableOpacity
        style={[
          styles.chip,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          !selectedCategory && { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
        ]}
        onPress={() => setSelectedCategory(null)}
        activeOpacity={0.7}
      >
        <MaterialIcons
          name="inbox"
          size={14}
          color={!selectedCategory ? theme.colors.onPrimary : theme.colors.textSecondary}
          style={styles.chipIcon}
        />
        <Text
          style={[
            styles.chipText,
            { color: !selectedCategory ? theme.colors.onPrimary : theme.colors.textSecondary },
          ]}
        >
          全部
        </Text>
      </TouchableOpacity>
      {categories.map((category) => {
        const isActive = selectedCategory === category.id;
        return (
          <TouchableOpacity
            key={category.id}
            style={[
              styles.chip,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              isActive && { backgroundColor: category.color + '20', borderColor: category.color + '40' },
            ]}
            onPress={() => setSelectedCategory(category.id)}
            activeOpacity={0.7}
          >
            <View style={[styles.chipDot, { backgroundColor: category.color }]} />
            <Text
              style={[
                styles.chipText,
                { color: isActive ? category.color : theme.colors.textSecondary },
                isActive && { fontWeight: '600' },
              ]}
            >
              {category.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  ), [selectedCategory, categories, theme, setSelectedCategory]);

  const renderQuickActions = useCallback(() => (
    <CollapsibleSection
      title="快速导航"
      subtitle="日历 · 项目 · 目标 · 习惯"
      icon="bolt"
      iconColor={theme.colors.warning}
      defaultExpanded={true}
      theme={theme}
      compact
    >
      <View style={styles.quickActionsGrid}>
        {[
          { icon: 'calendar-today', label: '日历', color: theme.colors.primary, bg: theme.colors.primary + '14', target: 'Calendar' },
          { icon: 'folder', label: '项目', color: theme.colors.secondary, bg: theme.colors.secondary + '14', target: 'Projects' },
          { icon: 'gps-fixed', label: '目标', color: theme.colors.success, bg: theme.colors.success + '14', target: 'Goals' },
          { icon: 'sync', label: '习惯', color: theme.colors.warning, bg: theme.colors.warning + '14', target: 'Habits' },
        ].map((item) => (
          <TouchableOpacity
            key={item.label}
            style={[styles.quickAction, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            onPress={() => navigation.navigate(item.target as any)}
            activeOpacity={0.7}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: item.bg }]}>
              <MaterialIcons name={item.icon as any} size={20} color={item.color} />
            </View>
            <Text style={[styles.quickActionText, { color: theme.colors.text }]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity
        style={[styles.moreFeaturesLink, { backgroundColor: theme.colors.primary + '08', borderColor: theme.colors.primary + '30' }]}
        onPress={() => setDrawerOpen(true)}
        activeOpacity={0.7}
      >
        <MaterialIcons name="apps" size={16} color={theme.colors.primary} />
        <Text style={[styles.moreFeaturesLinkText, { color: theme.colors.primary }]}>
          查看全部功能（日历 · 项目 · 笔记 · 统计 · 标签 · 模板 ...）
        </Text>
        <MaterialIcons name="chevron-right" size={16} color={theme.colors.primary} />
      </TouchableOpacity>
    </CollapsibleSection>
  ), [theme, navigation]);

  const drawerItems: DrawerItem[] = useMemo(() => [
    { key: 'search', icon: 'search', label: '搜索', description: '全文搜索任务', color: theme.colors.text, target: 'Search', group: 'tool' as const },
    { key: 'reorder', icon: 'swap-vert', label: '重排任务', description: '拖拽排序', color: theme.colors.text, target: 'reorder', group: 'tool' as const },
    { key: 'focus', icon: 'self-improvement', label: '专注模式', description: 'Forest 风格 + 白噪声', color: theme.colors.primary, target: 'focus', group: 'tool' as const },
    { key: 'settings', icon: 'settings', label: '设置', description: '主题、通知、主题', color: theme.colors.textSecondary, target: 'Settings', group: 'tool' as const },

    { key: 'calendar', icon: 'calendar-today', label: '日历视图', description: '按日期查看任务', color: theme.colors.primary, target: 'Calendar', group: 'organize' as const },
    { key: 'projects', icon: 'folder', label: '项目', description: '多项目分组管理', color: theme.colors.secondary, target: 'Projects', group: 'organize' as const },
    { key: 'goals', icon: 'gps-fixed', label: '目标', description: '长期目标追踪', color: theme.colors.success, target: 'Goals', group: 'organize' as const },
    { key: 'habits', icon: 'sync', label: '习惯', description: '每日打卡', color: theme.colors.warning, target: 'Habits', group: 'organize' as const },
    { key: 'notes', icon: 'edit-note', label: '笔记', description: 'Markdown 富文本', color: theme.colors.info, target: 'Notes', group: 'organize' as const },

    { key: 'analytics', icon: 'analytics', label: '统计分析', description: '完成率、趋势', color: theme.colors.accent, target: 'Analytics', group: 'insight' as const },

    { key: 'categories', icon: 'label', label: '分类管理', description: '管理任务分类', color: theme.colors.secondary, target: 'Categories', group: 'manage' as const },
    { key: 'tags', icon: 'local-offer', label: '标签', description: '灵活标记', color: theme.colors.warning, target: 'Tags', group: 'manage' as const },
    { key: 'views', icon: 'view-list', label: '视图', description: '看板 / 列表 / 日历', color: theme.colors.info, target: 'Views', group: 'manage' as const },
    { key: 'templates', icon: 'file-copy', label: '模板', description: '复用任务模板', color: theme.colors.success, target: 'Templates', group: 'manage' as const },
    { key: 'automation', icon: 'auto-awesome', label: '自动化', description: 'AI 任务建议', color: theme.colors.primary, target: 'Automation', group: 'manage' as const },
  ], [theme]);

  const handleDrawerNavigate = useCallback((target: string) => {
    if (target === 'reorder') {
      openReorder();
    } else if (target === 'focus') {
      const nextTask = sortedTasks.find((t) => !t.completed);
      setFocusTaskTitle(nextTask?.title);
      setShowFocus(true);
    } else {
      navigation.navigate(target as any);
    }
  }, [navigation, sortedTasks, openReorder]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={sortedTasks}
        renderItem={renderTask}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
          />
        }
        contentContainerStyle={[styles.list, bulk.active && { paddingBottom: 80 }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {renderHeader()}
            {renderStats()}
            <TaskSuggestions onApply={handleApplySuggestion} />
            {renderQuickActions()}
            {renderCategories()}
          </>
        }
        ListEmptyComponent={
          <EmptyState
            illustration="inbox"
            title="今日无任务"
            description="享受轻松的时光，或点击下方 + 按钮添加新任务"
          />
        }
      />
      {bulk.active && (
        <MultiSelectBar
          count={bulk.count}
          total={sortedTasks.length}
          onSelectAll={bulk.selectAll}
          onClear={bulk.clear}
          onExit={bulk.exit}
          actions={bulkActions}
        />
      )}
      <FocusMode
        visible={showFocus}
        onClose={() => setShowFocus(false)}
        taskTitle={focusTaskTitle}
        onComplete={() => toast.success('完成一个专注回合 🎯')}
      />
      <Modal
        visible={showReorder}
        animationType="slide"
        onRequestClose={() => setShowReorder(false)}
      >
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
          <View style={[styles.reorderHeader, { borderBottomColor: theme.colors.border }]}>
            <TouchableOpacity onPress={() => setShowReorder(false)} style={styles.iconButton}>
              <MaterialIcons name="close" size={22} color={theme.colors.text} />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.title, { color: theme.colors.text, fontSize: 20 }]}>重排任务</Text>
              <Text style={{ fontSize: 12, color: theme.colors.textTertiary, marginTop: 2 }}>
                长按拖拽手柄 ({Platform.OS === 'web' ? '250ms' : '0.25秒'}) · 共 {reorderList.length} 项
              </Text>
            </View>
            <TouchableOpacity
              onPress={saveReorder}
              style={[styles.saveBtn, { backgroundColor: theme.colors.primary }]}
              activeOpacity={0.85}
            >
              <MaterialIcons name="check" size={18} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '600', marginLeft: 4 }}>保存</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingVertical: 8 }}
            showsVerticalScrollIndicator={false}
          >
            {reorderList.length === 0 ? (
              <EmptyState
                illustration="inbox"
                title="暂无可重排任务"
                description="先添加一些任务再来管理顺序"
              />
            ) : (
              <DraggableList
                data={reorderList}
                keyExtractor={(t) => t.id}
                itemHeight={64}
                onReorder={handleReorder}
                renderItem={(item, index, _drag, isActive) => (
                  <View
                    style={[
                      styles.reorderRow,
                      {
                        backgroundColor: isActive ? theme.colors.primary + '10' : theme.colors.card,
                        borderColor: theme.colors.border,
                      },
                    ]}
                  >
                    <View style={styles.reorderIndex}>
                      <Text style={{ color: theme.colors.textTertiary, fontSize: 12, fontWeight: '600' }}>
                        {index + 1}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          color: theme.colors.text,
                          fontSize: 14,
                          fontWeight: '600',
                        }}
                        numberOfLines={1}
                      >
                        {item.title}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        {item.priority && (
                          <View
                            style={[
                              styles.priorityDot,
                              {
                                backgroundColor:
                                  item.priority === 'urgent'
                                    ? '#ef4444'
                                    : item.priority === 'high'
                                    ? '#f59e0b'
                                    : item.priority === 'medium'
                                    ? '#3b82f6'
                                    : '#94a3b8',
                              },
                            ]}
                          />
                        )}
                        {item.dueDate && (
                          <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>
                            {new Date(item.dueDate).toLocaleDateString()}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>
                )}
              />
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <SideDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        items={drawerItems}
        onNavigate={handleDrawerNavigate}
        pendingCount={pendingCount}
        completedToday={completedCount}
        theme={theme}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 18,
  },
  headerTitleWrap: {
    flex: 1,
  },
  greeting: {
    fontSize: 14,
    marginBottom: 4,
    letterSpacing: 0.1,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.6,
    lineHeight: 38,
  },
  versionBadge: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
    marginLeft: 4,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  moreFeaturesLink: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
    gap: 8,
  },
  moreFeaturesLinkText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 46,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 18,
    gap: 10,
  },
  statCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statTextWrap: {
    flex: 1,
  },
  statNumber: {
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 22,
    letterSpacing: -0.3,
  },
  statPercent: {
    fontSize: 12,
    fontWeight: '500',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
    letterSpacing: 0.1,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingBottom: 18,
    gap: 8,
  },
  quickAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    minWidth: '30%',
    flexGrow: 1,
  },
  quickActionIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickActionText: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  chipRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipIcon: {
    marginRight: 5,
  },
  chipDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  moreSection: {
    paddingTop: 8,
  },
  moreSectionHeader: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  moreSectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 100,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 64,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  reorderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  reorderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 4,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    minHeight: 64,
  },
  reorderIndex: {
    width: 24,
    alignItems: 'center',
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
