import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../src/shared/store';
import { RootStackParamList, Task, Priority, TaskStatus } from '../src/shared/types';
import { TaskCard } from '../src/shared/components/common';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Search'>;

interface SearchFilter {
  field: string;
  operator: string;
  value: any;
  conjunction: 'AND' | 'OR';
}

export default function SearchScreen() {
  const navigation = useNavigation<NavigationProp>();
  const {
    theme,
    tasks,
    projects,
    categories,
    tags,
    searchHistory,
    addSearchToHistory,
    clearSearchHistory: clearSearchHistoryFromStore,
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilter[]>([]);
  const [sortBy, setSortBy] = useState<string>('updatedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showFilters, setShowFilters] = useState(false);
  const [showSortOptions, setShowSortOptions] = useState(false);
  const [recentTasks, setRecentTasks] = useState<Task[]>([]);

  useEffect(() => {
    const recent = tasks
      .filter((task) => !task.isDeleted)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);
    setRecentTasks(recent);
  }, [tasks]);

  const addFilter = (field: string, operator: string = 'contains', value: any = '') => {
    setFilters([...filters, { field, operator, value, conjunction: filters.length > 0 ? 'AND' : 'AND' }]);
  };

  const removeFilter = (index: number) => {
    setFilters(filters.filter((_, i) => i !== index));
  };

  const clearAllFilters = () => {
    setFilters([]);
  };

  const performSearch = useMemo(() => {
    let results = tasks.filter((task) => !task.isDeleted);

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      results = results.filter((task) =>
        task.title.toLowerCase().includes(query) ||
        task.description.toLowerCase().includes(query) ||
        task.content.toLowerCase().includes(query) ||
        task.tags.some((tagId) => {
          const tag = tags.find((t) => t.id === tagId);
          return tag?.name.toLowerCase().includes(query);
        })
      );
    }

    filters.forEach((filter) => {
      results = applyFilter(results, filter);
    });

    results.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'dueDate': {
          const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          comparison = aDate - bDate;
          break;
        }
        case 'priority': {
          const priorityOrder = { critical: 0, urgent: 1, high: 2, medium: 3, low: 4 };
          comparison = priorityOrder[a.priority] - priorityOrder[b.priority];
          break;
        }
        case 'createdAt':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'updatedAt':
        default:
          comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return results;
  }, [tasks, searchQuery, filters, sortBy, sortOrder, tags]);

  const applyFilter = (taskList: Task[], filter: SearchFilter): Task[] => {
    return taskList.filter((task) => {
      let fieldValue: any;

      switch (filter.field) {
        case 'status':
          fieldValue = task.status;
          break;
        case 'priority':
          fieldValue = task.priority;
          break;
        case 'project':
          fieldValue = task.projectId;
          break;
        case 'category':
          fieldValue = task.categoryId;
          break;
        case 'hasDueDate':
          fieldValue = task.dueDate !== null;
          break;
        case 'isCompleted':
          fieldValue = task.completed;
          break;
        case 'isStarred':
          fieldValue = task.isStarred;
          break;
        case 'isArchived':
          fieldValue = task.isArchived;
          break;
        case 'hasSubtasks':
          fieldValue = task.subtasks.length > 0;
          break;
        case 'hasAttachments':
          fieldValue = task.attachments.length > 0;
          break;
        case 'hasComments':
          fieldValue = task.comments.length > 0;
          break;
        case 'isOverdue':
          fieldValue = task.dueDate && new Date(task.dueDate) < new Date() && !task.completed;
          break;
        case 'dueToday': {
          const today = new Date();
          fieldValue = task.dueDate &&
            new Date(task.dueDate).toDateString() === today.toDateString();
          break;
        }
        case 'dueThisWeek': {
          const today = new Date();
          const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
          fieldValue = task.dueDate &&
            new Date(task.dueDate) >= today &&
            new Date(task.dueDate) <= nextWeek;
          break;
        }
        default:
          return true;
      }

      switch (filter.operator) {
        case 'equals':
          return fieldValue === filter.value;
        case 'not-equals':
          return fieldValue !== filter.value;
        case 'contains':
          if (typeof fieldValue === 'string') {
            return fieldValue.toLowerCase().includes(String(filter.value).toLowerCase());
          }
          return Array.isArray(fieldValue) && fieldValue.includes(filter.value);
        case 'is-empty':
          return !fieldValue || (Array.isArray(fieldValue) && fieldValue.length === 0);
        case 'is-not-empty':
          return fieldValue && (!Array.isArray(fieldValue) || fieldValue.length > 0);
        case 'greater-than':
          return fieldValue > filter.value;
        case 'less-than':
          return fieldValue < filter.value;
        default:
          return true;
      }
    });
  };

  const saveSearchToHistory = () => {
    if (searchQuery.trim()) {
      addSearchToHistory(searchQuery);
    }
  };

  const handleSearch = () => {
    saveSearchToHistory();
  };

  const clearSearchHistory = () => {
    clearSearchHistoryFromStore();
  };

  const getFieldLabel = (field: string): string => {
    const labels: Record<string, string> = {
      status: '状态',
      priority: '优先级',
      project: '项目',
      category: '分类',
      hasDueDate: '有截止日期',
      isCompleted: '已完成',
      isStarred: '已标记',
      isArchived: '已归档',
      hasSubtasks: '有子任务',
      hasAttachments: '有附件',
      hasComments: '有评论',
      isOverdue: '已逾期',
      dueToday: '今日截止',
      dueThisWeek: '本周截止',
    };
    return labels[field] || field;
  };

  const getOperatorLabel = (operator: string): string => {
    const labels: Record<string, string> = {
      'equals': '等于',
      'not-equals': '不等于',
      'contains': '包含',
      'is-empty': '为空',
      'is-not-empty': '不为空',
      'greater-than': '大于',
      'less-than': '小于',
    };
    return labels[operator] || operator;
  };

  const getFilterDisplayText = (filter: SearchFilter): string => {
    let valueDisplay = '';
    
    switch (filter.field) {
      case 'status': {
        const statusLabels: Record<string, string> = {
          'todo': '待办',
          'in-progress': '进行中',
          'waiting': '等待中',
          'delegated': '已委托',
          'completed': '已完成',
          'cancelled': '已取消',
          'on-hold': '暂停',
        };
        valueDisplay = statusLabels[filter.value] || filter.value;
        break;
      }
      case 'priority': {
        const priorityLabels: Record<string, string> = {
          'low': '低',
          'medium': '中',
          'high': '高',
          'urgent': '紧急',
          'critical': '紧急且重要',
        };
        valueDisplay = priorityLabels[filter.value] || filter.value;
        break;
      }
      case 'project': {
        const project = projects.find((p) => p.id === filter.value);
        valueDisplay = project?.name || filter.value;
        break;
      }
      case 'category': {
        const category = categories.find((c) => c.id === filter.value);
        valueDisplay = category?.name || filter.value;
        break;
      }
      default:
        valueDisplay = String(filter.value);
    }

    return `${getFieldLabel(filter.field)} ${getOperatorLabel(filter.operator)}${valueDisplay ? ` "${valueDisplay}"` : ''}`;
  };

  const renderSearchBar = () => (
    <View style={[styles.searchBar, { backgroundColor: theme.colors.surface }]}>
      <View style={[styles.searchInputContainer, { backgroundColor: theme.colors.background }]}>
        <MaterialIcons name="search" size={16} color={theme.colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: theme.colors.text }]}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="搜索任务、项目、标签..."
          placeholderTextColor={theme.colors.textSecondary}
          returnKeyType="search"
          onSubmitEditing={handleSearch}
          autoFocus
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <MaterialIcons name="close" size={20} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity
        style={[styles.filterButton, { backgroundColor: filters.length > 0 ? theme.colors.primary : theme.colors.background }]}
        onPress={() => setShowFilters(!showFilters)}
      >
        <Text style={[styles.filterButtonText, { color: filters.length > 0 ? '#FFFFFF' : theme.colors.primary }]}>
          筛选 {filters.length > 0 && `(${filters.length})`}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.sortButton, { backgroundColor: theme.colors.background }]}
        onPress={() => setShowSortOptions(!showSortOptions)}
      >
        <MaterialIcons name="swap-vert" size={18} color={theme.colors.primary} />
      </TouchableOpacity>
    </View>
  );

  const renderFilterPanel = () => (
    <View style={[styles.filterPanel, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.filterPanelHeader}>
        <Text style={[styles.filterPanelTitle, { color: theme.colors.text }]}>筛选条件</Text>
        <TouchableOpacity onPress={clearAllFilters}>
          <Text style={[styles.clearFiltersText, { color: theme.colors.error }]}>清除全部</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterChips}>
        <TouchableOpacity
          style={[styles.filterChip, { backgroundColor: theme.colors.background }]}
          onPress={() => addFilter('status', 'equals', 'in-progress')}
        >
          <Text style={[styles.filterChipText, { color: theme.colors.text }]}>进行中</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, { backgroundColor: theme.colors.background }]}
          onPress={() => addFilter('priority', 'equals', 'high')}
        >
          <Text style={[styles.filterChipText, { color: theme.colors.text }]}>高优先级</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, { backgroundColor: theme.colors.background }]}
          onPress={() => addFilter('isOverdue')}
        >
          <Text style={[styles.filterChipText, { color: theme.colors.text }]}>已逾期</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, { backgroundColor: theme.colors.background }]}
          onPress={() => addFilter('dueToday')}
        >
          <Text style={[styles.filterChipText, { color: theme.colors.text }]}>今日截止</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, { backgroundColor: theme.colors.background }]}
          onPress={() => addFilter('isStarred')}
        >
          <Text style={[styles.filterChipText, { color: theme.colors.text }]}>已标记</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, { backgroundColor: theme.colors.background }]}
          onPress={() => addFilter('isCompleted', 'equals', true)}
        >
          <Text style={[styles.filterChipText, { color: theme.colors.text }]}>已完成</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, { backgroundColor: theme.colors.background }]}
          onPress={() => addFilter('hasSubtasks')}
        >
          <Text style={[styles.filterChipText, { color: theme.colors.text }]}>有子任务</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, { backgroundColor: theme.colors.background }]}
          onPress={() => addFilter('hasAttachments')}
        >
          <Text style={[styles.filterChipText, { color: theme.colors.text }]}>有附件</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.filterSections}>
        <Text style={[styles.filterSectionTitle, { color: theme.colors.textSecondary }]}>按状态</Text>
        <View style={styles.filterRow}>
          {(['todo', 'in-progress', 'waiting', 'delegated', 'completed'] as TaskStatus[]).map((status) => (
            <TouchableOpacity
              key={status}
              style={[styles.statusFilterChip, { backgroundColor: theme.colors.background }]}
              onPress={() => addFilter('status', 'equals', status)}
            >
              <Text style={[styles.filterChipText, { color: theme.colors.text }]}>
                {status === 'todo' ? '待办' :
                 status === 'in-progress' ? '进行中' :
                 status === 'waiting' ? '等待中' :
                 status === 'delegated' ? '已委托' : '已完成'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.filterSectionTitle, { color: theme.colors.textSecondary }]}>按优先级</Text>
        <View style={styles.filterRow}>
          {(['critical', 'urgent', 'high', 'medium', 'low'] as Priority[]).map((priority) => (
            <TouchableOpacity
              key={priority}
              style={[styles.priorityFilterChip, { backgroundColor: theme.colors.background }]}
              onPress={() => addFilter('priority', 'equals', priority)}
            >
              <Text style={[styles.filterChipText, { color: theme.colors.text }]}>
                {priority === 'critical' ? '紧急且重要' :
                 priority === 'urgent' ? '紧急' :
                 priority === 'high' ? '高' :
                 priority === 'medium' ? '中' : '低'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.filterSectionTitle, { color: theme.colors.textSecondary }]}>按项目</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {projects.map((project) => (
            <TouchableOpacity
              key={project.id}
              style={[styles.projectFilterChip, { backgroundColor: project.color + '20' }]}
              onPress={() => addFilter('project', 'equals', project.id)}
            >
              <Text style={[styles.filterChipText, { color: project.color }]}>{project.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={[styles.filterSectionTitle, { color: theme.colors.textSecondary }]}>按分类</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {categories.map((category) => (
            <TouchableOpacity
              key={category.id}
              style={[styles.projectFilterChip, { backgroundColor: category.color + '20' }]}
              onPress={() => addFilter('category', 'equals', category.id)}
            >
              <Text style={[styles.filterChipText, { color: category.color }]}>{category.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {filters.length > 0 && (
        <View style={styles.activeFilters}>
          <Text style={[styles.activeFiltersTitle, { color: theme.colors.textSecondary }]}>已选条件:</Text>
          <View style={styles.activeFiltersRow}>
            {filters.map((filter, index) => (
              <TouchableOpacity
                key={index}
                style={[styles.activeFilterChip, { backgroundColor: theme.colors.primary + '20' }]}
                onPress={() => removeFilter(index)}
              >
                <Text style={[styles.activeFilterText, { color: theme.colors.primary }]}>
                  {getFilterDisplayText(filter)} ×
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </View>
  );

  const renderSortOptions = () => (
    <View style={[styles.sortPanel, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sortPanelTitle, { color: theme.colors.text }]}>排序方式</Text>
      <View style={styles.sortOptions}>
        <TouchableOpacity
          style={[
            styles.sortOption,
            sortBy === 'updatedAt' && { backgroundColor: theme.colors.primary + '20' },
          ]}
          onPress={() => setSortBy('updatedAt')}
        >
          <Text style={[styles.sortOptionText, { color: theme.colors.text }]}>最近更新</Text>
          {sortBy === 'updatedAt' && (
            <MaterialIcons
              name={sortOrder === 'desc' ? 'arrow-downward' : 'arrow-upward'}
              size={16}
              color={theme.colors.primary}
            />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.sortOption,
            sortBy === 'createdAt' && { backgroundColor: theme.colors.primary + '20' },
          ]}
          onPress={() => setSortBy('createdAt')}
        >
          <Text style={[styles.sortOptionText, { color: theme.colors.text }]}>创建时间</Text>
          {sortBy === 'createdAt' && (
            <MaterialIcons
              name={sortOrder === 'desc' ? 'arrow-downward' : 'arrow-upward'}
              size={16}
              color={theme.colors.primary}
            />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.sortOption,
            sortBy === 'dueDate' && { backgroundColor: theme.colors.primary + '20' },
          ]}
          onPress={() => setSortBy('dueDate')}
        >
          <Text style={[styles.sortOptionText, { color: theme.colors.text }]}>截止日期</Text>
          {sortBy === 'dueDate' && (
            <MaterialIcons
              name={sortOrder === 'desc' ? 'arrow-downward' : 'arrow-upward'}
              size={16}
              color={theme.colors.primary}
            />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.sortOption,
            sortBy === 'priority' && { backgroundColor: theme.colors.primary + '20' },
          ]}
          onPress={() => setSortBy('priority')}
        >
          <Text style={[styles.sortOptionText, { color: theme.colors.text }]}>优先级</Text>
          {sortBy === 'priority' && (
            <MaterialIcons
              name={sortOrder === 'desc' ? 'arrow-downward' : 'arrow-upward'}
              size={16}
              color={theme.colors.primary}
            />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.sortOption,
            sortBy === 'title' && { backgroundColor: theme.colors.primary + '20' },
          ]}
          onPress={() => setSortBy('title')}
        >
          <Text style={[styles.sortOptionText, { color: theme.colors.text }]}>标题</Text>
          {sortBy === 'title' && (
            <MaterialIcons
              name={sortOrder === 'desc' ? 'arrow-downward' : 'arrow-upward'}
              size={16}
              color={theme.colors.primary}
            />
          )}
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={styles.sortOrderToggle}
        onPress={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
      >
        <Text style={[styles.sortOrderToggleText, { color: theme.colors.primary }]}>
          {sortOrder === 'asc' ? '升序' : '降序'}
          <MaterialIcons
            name={sortOrder === 'asc' ? 'arrow-upward' : 'arrow-downward'}
            size={14}
            color={theme.colors.primary}
          />
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderSearchHistory = () => (
    <View style={styles.historySection}>
      {searchHistory.length > 0 && (
        <>
          <View style={styles.historyHeader}>
            <Text style={[styles.historyTitle, { color: theme.colors.textSecondary }]}>搜索历史</Text>
            <TouchableOpacity onPress={clearSearchHistory}>
              <Text style={[styles.clearHistoryText, { color: theme.colors.error }]}>清除</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {searchHistory.map((history, index) => (
              <TouchableOpacity
                key={index}
                style={[styles.historyChip, { backgroundColor: theme.colors.surface }]}
                onPress={() => setSearchQuery(history)}
              >
                <Text style={[styles.historyChipText, { color: theme.colors.text }]}>{history}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );

  const renderRecentSection = () => (
    <View style={styles.recentSection}>
      <Text style={[styles.recentTitle, { color: theme.colors.textSecondary }]}>最近查看</Text>
      <FlatList
        data={recentTasks}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.recentItem, { backgroundColor: theme.colors.surface }]}
            onPress={() => navigation.navigate('TaskDetail', { taskId: item.id })}
          >
            <Text style={[styles.recentItemTitle, { color: theme.colors.text }]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={[styles.recentItemDate, { color: theme.colors.textSecondary }]}>
              {new Date(item.updatedAt).toLocaleDateString()}
            </Text>
          </TouchableOpacity>
        )}
        horizontal
        showsHorizontalScrollIndicator={false}
      />
    </View>
  );

  const renderResults = () => (
    <FlatList
      data={performSearch}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <TaskCard
          task={item}
          onPress={() => navigation.navigate('TaskDetail', { taskId: item.id })}
        />
      )}
      ListHeaderComponent={() => (
        <View style={styles.resultsHeader}>
          <Text style={[styles.resultsCount, { color: theme.colors.textSecondary }]}>
            找到 {performSearch.length} 个结果
          </Text>
        </View>
      )}
      ListEmptyComponent={() => (
        <View style={styles.emptyResults}>
          <MaterialIcons name="search" size={64} color={theme.colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
            {searchQuery || filters.length > 0 ? '未找到匹配的任务' : '开始搜索'}
          </Text>
          <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>
            {searchQuery || filters.length > 0
              ? '尝试调整搜索条件或筛选器'
              : '输入关键词搜索任务、项目或标签'}
          </Text>
        </View>
      )}
      contentContainerStyle={styles.resultsList}
    />
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color={theme.colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>搜索</Text>
        <View style={styles.headerRight} />
      </View>

      {renderSearchBar()}
      {showFilters && renderFilterPanel()}
      {showSortOptions && renderSortOptions()}

      {searchQuery.length === 0 && filters.length === 0 ? (
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {renderSearchHistory()}
          {renderRecentSection()}
        </ScrollView>
      ) : (
        renderResults()
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  backButton: {
    padding: 4,
  },
  backButtonText: {
    fontSize: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerRight: {
    width: 60,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 12,
    marginRight: 8,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 8,
  },
  clearIcon: {
    fontSize: 20,
    padding: 4,
  },
  filterButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  sortButton: {
    padding: 8,
    borderRadius: 8,
  },
  sortIcon: {
    fontSize: 18,
  },
  filterPanel: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  filterPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  filterPanelTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  clearFiltersText: {
    fontSize: 14,
  },
  filterChips: {
    marginBottom: 12,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  filterChipText: {
    fontSize: 12,
  },
  filterSections: {
    marginTop: 8,
  },
  filterSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 12,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  statusFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  priorityFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  projectFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 8,
  },
  activeFilters: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  activeFiltersTitle: {
    fontSize: 12,
    marginBottom: 8,
  },
  activeFiltersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  activeFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 8,
  },
  activeFilterText: {
    fontSize: 12,
  },
  sortPanel: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  sortPanelTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  sortOptions: {
    marginBottom: 12,
  },
  sortOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  sortOptionText: {
    fontSize: 14,
  },
  sortOrderIcon: {
    fontSize: 16,
    fontWeight: '600',
  },
  sortOrderToggle: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  sortOrderToggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  historySection: {
    marginBottom: 24,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  clearHistoryText: {
    fontSize: 12,
  },
  historyChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    marginRight: 8,
  },
  historyChipText: {
    fontSize: 14,
  },
  recentSection: {
    marginBottom: 24,
  },
  recentTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  recentItem: {
    width: 200,
    padding: 12,
    borderRadius: 8,
    marginRight: 12,
  },
  recentItemTitle: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  recentItemDate: {
    fontSize: 12,
  },
  resultsHeader: {
    padding: 16,
  },
  resultsCount: {
    fontSize: 14,
  },
  resultsList: {
    padding: 16,
  },
  emptyResults: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    marginTop: 60,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
});
