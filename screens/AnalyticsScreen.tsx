import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../src/shared/store';
import { RootStackParamList } from '../src/shared/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Analytics'>;

const { width } = Dimensions.get('window');

type TimeRange = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'all';

const getDaysBetween = (start: Date, end: Date): number => {
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

export default function AnalyticsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { theme, tasks, projects, goals, habits } = useAppStore();

  const [timeRange, setTimeRange] = useState<TimeRange>('week');

  const getDateRange = (range: TimeRange): { start: Date; end: Date } => {
    const end = new Date();
    const start = new Date();
    
    switch (range) {
      case 'today':
        start.setHours(0, 0, 0, 0);
        break;
      case 'week':
        start.setDate(end.getDate() - 7);
        break;
      case 'month':
        start.setMonth(end.getMonth() - 1);
        break;
      case 'quarter':
        start.setMonth(end.getMonth() - 3);
        break;
      case 'year':
        start.setFullYear(end.getFullYear() - 1);
        break;
      case 'all':
        start.setFullYear(2000);
        break;
    }
    
    return { start, end };
  };

  const filteredTasks = useMemo(() => {
    const { start, end } = getDateRange(timeRange);
    return tasks.filter((task) => {
      if (task.isDeleted) return false;
      const taskDate = new Date(task.createdAt);
      return taskDate >= start && taskDate <= end;
    });
  }, [tasks, timeRange]);

  const completedTasks = useMemo(() => {
    return filteredTasks.filter((task) => task.completed);
  }, [filteredTasks]);

  const completionRate = useMemo(() => {
    if (filteredTasks.length === 0) return 0;
    return (completedTasks.length / filteredTasks.length) * 100;
  }, [filteredTasks, completedTasks]);

  const overdueTasks = useMemo(() => {
    const now = new Date();
    return filteredTasks.filter(
      (task) => !task.completed && task.dueDate && new Date(task.dueDate) < now
    );
  }, [filteredTasks]);

  const upcomingTasks = useMemo(() => {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return filteredTasks.filter(
      (task) => !task.completed && task.dueDate && new Date(task.dueDate) >= now && new Date(task.dueDate) <= nextWeek
    );
  }, [filteredTasks]);

  const productivityScore = useMemo(() => {
    const onTimeCompletion = completedTasks.filter((task) => {
      if (!task.dueDate || !task.completedAt) return true;
      return new Date(task.completedAt) <= new Date(task.dueDate);
    }).length;
    
    const completionScore = completionRate * 0.4;
    const onTimeScore = completedTasks.length > 0 
      ? (onTimeCompletion / completedTasks.length) * 100 * 0.3 
      : 0;
    const consistencyScore = Math.min(filteredTasks.length / 10, 1) * 100 * 0.3;
    
    return Math.round(completionScore + onTimeScore + consistencyScore);
  }, [filteredTasks, completedTasks, completionRate]);

  const averageTasksPerDay = useMemo(() => {
    const days = getDaysBetween(getDateRange(timeRange).start, new Date());
    return days > 0 ? (filteredTasks.length / days).toFixed(1) : '0';
  }, [filteredTasks, timeRange]);

  const averageCompletionTime = useMemo(() => {
    const tasksWithCompletionTime = completedTasks.filter(
      (task) => task.dueDate && task.completedAt
    );
    if (tasksWithCompletionTime.length === 0) return 'N/A';
    
    const totalTime = tasksWithCompletionTime.reduce((acc, task) => {
      const completionTime = new Date(task.completedAt!).getTime() - new Date(task.dueDate!).getTime();
      return acc + completionTime;
    }, 0);
    
    const hours = Math.round(totalTime / tasksWithCompletionTime.length / (1000 * 60 * 60));
    return `${hours}小时`;
  }, [completedTasks]);

  const tasksByStatus = useMemo(() => {
    const stats: Record<string, number> = {
      'todo': 0,
      'in-progress': 0,
      'waiting': 0,
      'delegated': 0,
      'completed': 0,
      'cancelled': 0,
      'on-hold': 0,
    };
    
    filteredTasks.forEach((task) => {
      stats[task.status]++;
    });
    
    return stats;
  }, [filteredTasks]);

  const tasksByPriority = useMemo(() => {
    const stats: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0,
      urgent: 0,
      critical: 0,
    };
    
    filteredTasks.forEach((task) => {
      stats[task.priority]++;
    });
    
    return stats;
  }, [filteredTasks]);

  const tasksByProject = useMemo(() => {
    const stats: Record<string, number> = {};
    
    filteredTasks.forEach((task) => {
      const projectId = task.projectId || 'no-project';
      stats[projectId] = (stats[projectId] || 0) + 1;
    });
    
    return stats;
  }, [filteredTasks]);

  const dailyCompletionTrend = useMemo(() => {
    const days = timeRange === 'today' ? 1 : timeRange === 'week' ? 7 : timeRange === 'month' ? 30 : 90;
    const trend: { date: string; count: number }[] = [];
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const count = completedTasks.filter((task) => {
        if (!task.completedAt) return false;
        return new Date(task.completedAt).toISOString().split('T')[0] === dateStr;
      }).length;
      
      trend.push({ date: dateStr, count });
    }
    
    return trend;
  }, [completedTasks, timeRange]);

  const streakDays = useMemo(() => {
    let streak = 0;
    const today = new Date();
    
    for (let i = 0; i < 365; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const hasCompletedTask = completedTasks.some((task) => {
        if (!task.completedAt) return false;
        return new Date(task.completedAt).toISOString().split('T')[0] === dateStr;
      });
      
      if (hasCompletedTask) {
        streak++;
      } else if (i > 0) {
        break;
      }
    }
    
    return streak;
  }, [completedTasks]);

  const goalProgress = useMemo(() => {
    return goals.map((goal) => {
      const currentProgress = goal.currentValue || 0;
      const targetValue = goal.targetValue || 1;
      const progress = Math.min((currentProgress / targetValue) * 100, 100);
      return { ...goal, progress };
    });
  }, [goals]);

  const habitCompletionRate = useMemo(() => {
    if (habits.length === 0) return 0;
    const totalRate = habits.reduce((acc, habit) => {
      const completedDays = Object.values(habit.completionHistory).filter(Boolean).length;
      const totalDays = getDaysBetween(new Date(habit.createdAt), new Date());
      return acc + (totalDays > 0 ? completedDays / totalDays : 0);
    }, 0);
    return Math.round((totalRate / habits.length) * 100);
  }, [habits]);

  const getStatusColor = (status: string): string => {
    const colors: Record<string, string> = {
      'todo': '#6b7280',
      'in-progress': '#3b82f6',
      'waiting': '#8b5cf6',
      'delegated': '#f59e0b',
      'completed': '#10b981',
      'cancelled': '#ef4444',
      'on-hold': '#6b7280',
    };
    return colors[status] || theme.colors.primary;
  };

  const getPriorityColor = (priority: string): string => {
    const colors: Record<string, string> = {
      low: '#10b981',
      medium: '#f59e0b',
      high: '#f97316',
      urgent: '#ef4444',
      critical: '#dc2626',
    };
    return colors[priority] || theme.colors.primary;
  };

  const renderHeader = () => (
    <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
        <MaterialIcons name="arrow-back" size={24} color={theme.colors.primary} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: theme.colors.text }]}>统计分析</Text>
      <View style={styles.headerRight} />
    </View>
  );

  const renderTimeRangeSelector = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.timeRangeSelector}>
      {(['today', 'week', 'month', 'quarter', 'year', 'all'] as TimeRange[]).map((range) => (
        <TouchableOpacity
          key={range}
          style={[
            styles.timeRangeButton,
            timeRange === range && { backgroundColor: theme.colors.primary },
          ]}
          onPress={() => setTimeRange(range)}
        >
          <Text
            style={[
              styles.timeRangeText,
              { color: timeRange === range ? '#FFFFFF' : theme.colors.text },
            ]}
          >
            {range === 'today' ? '今天' :
             range === 'week' ? '本周' :
             range === 'month' ? '本月' :
             range === 'quarter' ? '季度' :
             range === 'year' ? '年度' : '全部'}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const renderOverviewCards = () => (
    <View style={styles.overviewGrid}>
      <View style={[styles.overviewCard, { backgroundColor: theme.colors.primary + '20' }]}>
        <Text style={[styles.overviewCardValue, { color: theme.colors.primary }]}>
          {filteredTasks.length}
        </Text>
        <Text style={[styles.overviewCardLabel, { color: theme.colors.textSecondary }]}>
          总任务数
        </Text>
      </View>
      
      <View style={[styles.overviewCard, { backgroundColor: '#10b98120' }]}>
        <Text style={[styles.overviewCardValue, { color: '#10b981' }]}>
          {completedTasks.length}
        </Text>
        <Text style={[styles.overviewCardLabel, { color: theme.colors.textSecondary }]}>
          已完成
        </Text>
      </View>
      
      <View style={[styles.overviewCard, { backgroundColor: '#ef444420' }]}>
        <Text style={[styles.overviewCardValue, { color: '#ef4444' }]}>
          {overdueTasks.length}
        </Text>
        <Text style={[styles.overviewCardLabel, { color: theme.colors.textSecondary }]}>
          已逾期
        </Text>
      </View>
      
      <View style={[styles.overviewCard, { backgroundColor: '#f59e0b20' }]}>
        <Text style={[styles.overviewCardValue, { color: '#f59e0b' }]}>
          {upcomingTasks.length}
        </Text>
        <Text style={[styles.overviewCardLabel, { color: theme.colors.textSecondary }]}>
          即将到期
        </Text>
      </View>
    </View>
  );

  const renderProductivityScore = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>生产力得分</Text>
      <View style={styles.scoreContainer}>
        <View style={[styles.scoreCircle, { borderColor: theme.colors?.primary || '#3b82f6' }]}>
          <Text style={[styles.scoreValue, { color: theme.colors.primary }]}>
            {productivityScore}
          </Text>
          <Text style={[styles.scoreMax, { color: theme.colors.textSecondary }]}>/100</Text>
        </View>
        <View style={styles.scoreDetails}>
          <View style={styles.scoreDetailRow}>
            <View style={[styles.scoreIndicator, { backgroundColor: theme.colors.primary }]} />
            <Text style={[styles.scoreDetailText, { color: theme.colors.text }]}>
              完成率 {completionRate.toFixed(1)}%
            </Text>
          </View>
          <View style={styles.scoreDetailRow}>
            <View style={[styles.scoreIndicator, { backgroundColor: '#10b981' }]} />
            <Text style={[styles.scoreDetailText, { color: theme.colors.text }]}>
              连续 {streakDays} 天
            </Text>
          </View>
          <View style={styles.scoreDetailRow}>
            <View style={[styles.scoreIndicator, { backgroundColor: '#f59e0b' }]} />
            <Text style={[styles.scoreDetailText, { color: theme.colors.text }]}>
              日均 {averageTasksPerDay} 任务
            </Text>
          </View>
        </View>
      </View>
    </View>
  );

  const renderCompletionRate = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>完成率</Text>
      <View style={styles.completionContainer}>
        <View style={styles.completionBar}>
          <View
            style={[
              styles.completionProgress,
              {
                backgroundColor: '#10b981',
                width: `${completionRate}%`,
              },
            ]}
          />
        </View>
        <Text style={[styles.completionText, { color: theme.colors.text }]}>
          {completionRate.toFixed(1)}%
        </Text>
      </View>
      <View style={styles.completionStats}>
        <Text style={[styles.completionStatText, { color: theme.colors.textSecondary }]}>
          {completedTasks.length} / {filteredTasks.length} 任务
        </Text>
      </View>
    </View>
  );

  const renderTasksByStatus = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>任务状态分布</Text>
      <View style={styles.statusChart}>
        {Object.entries(tasksByStatus).map(([status, count]) => (
          <View key={status} style={styles.statusRow}>
            <View style={styles.statusLabel}>
              <View style={[styles.statusDot, { backgroundColor: getStatusColor(status) }]} />
              <Text style={[styles.statusText, { color: theme.colors.text }]}>
                {status === 'todo' ? '待办' :
                 status === 'in-progress' ? '进行中' :
                 status === 'waiting' ? '等待中' :
                 status === 'delegated' ? '已委托' :
                 status === 'completed' ? '已完成' :
                 status === 'cancelled' ? '已取消' : '暂停'}
              </Text>
            </View>
            <View style={styles.statusBarContainer}>
              <View
                style={[
                  styles.statusBar,
                  {
                    backgroundColor: getStatusColor(status),
                    width: `${filteredTasks.length > 0 ? (count / filteredTasks.length) * 100 : 0}%`,
                  },
                ]}
              />
            </View>
            <Text style={[styles.statusCount, { color: theme.colors.textSecondary }]}>
              {count}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );

  const renderTasksByPriority = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>任务优先级分布</Text>
      <View style={styles.priorityChart}>
        {Object.entries(tasksByPriority).map(([priority, count]) => (
          <View key={priority} style={styles.priorityRow}>
            <View style={styles.priorityLabel}>
              <View style={[styles.priorityDot, { backgroundColor: getPriorityColor(priority) }]} />
              <Text style={[styles.priorityText, { color: theme.colors.text }]}>
                {priority === 'critical' ? '紧急且重要' :
                 priority === 'urgent' ? '紧急' :
                 priority === 'high' ? '高' :
                 priority === 'medium' ? '中' : '低'}
              </Text>
            </View>
            <View style={styles.priorityBarContainer}>
              <View
                style={[
                  styles.priorityBar,
                  {
                    backgroundColor: getPriorityColor(priority),
                    width: `${filteredTasks.length > 0 ? (count / filteredTasks.length) * 100 : 0}%`,
                  },
                ]}
              />
            </View>
            <Text style={[styles.priorityCount, { color: theme.colors.textSecondary }]}>
              {count}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );

  const renderDailyTrend = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>每日完成趋势</Text>
      <View style={styles.trendChart}>
        {dailyCompletionTrend.slice(-14).map((day, index) => {
          const maxCount = Math.max(...dailyCompletionTrend.map((d) => d.count), 1);
          const height = (day.count / maxCount) * 100;
          
          return (
            <View key={index} style={styles.trendBar}>
              <Text style={[styles.trendValue, { color: theme.colors.textSecondary }]}>
                {day.count}
              </Text>
              <View
                style={[
                  styles.trendBarFill,
                  {
                    backgroundColor: theme.colors.primary,
                    height: `${height}%`,
                  },
                ]}
              />
              <Text style={[styles.trendDate, { color: theme.colors.textSecondary }]}>
                {new Date(day.date).getDate()}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );

  const renderProjectDistribution = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>项目分布</Text>
      <View style={styles.projectList}>
        {Object.entries(tasksByProject)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([projectId, count]) => {
            const project = projects.find((p) => p.id === projectId);
            const projectName = project?.name || '无项目';
            const projectColor = project?.color || theme.colors.textSecondary;
            
            return (
              <View key={projectId} style={styles.projectRow}>
                <View style={styles.projectLabel}>
                  <View style={[styles.projectDot, { backgroundColor: projectColor }]} />
                  <Text style={[styles.projectText, { color: theme.colors.text }]} numberOfLines={1}>
                    {projectName}
                  </Text>
                </View>
                <Text style={[styles.projectCount, { color: theme.colors.textSecondary }]}>
                  {count} 任务
                </Text>
              </View>
            );
          })}
      </View>
    </View>
  );

  const renderGoalProgress = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>目标进度</Text>
      {goalProgress.length > 0 ? (
        goalProgress.map((goal) => (
          <View key={goal.id} style={styles.goalRow}>
            <Text style={[styles.goalTitle, { color: theme.colors.text }]} numberOfLines={1}>
              {goal.title}
            </Text>
            <View style={styles.goalProgressContainer}>
              <View style={styles.goalProgressBar}>
                <View
                  style={[
                    styles.goalProgressFill,
                    {
                      backgroundColor: goal.progress >= 100 ? '#10b981' : theme.colors.primary,
                      width: `${goal.progress}%`,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.goalProgressText, { color: theme.colors.textSecondary }]}>
                {goal.progress.toFixed(0)}%
              </Text>
            </View>
          </View>
        ))
      ) : (
        <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
          暂无目标
        </Text>
      )}
    </View>
  );

  const renderHabitStats = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>习惯追踪</Text>
      <View style={styles.habitStats}>
        <View style={styles.habitStatItem}>
          <Text style={[styles.habitStatValue, { color: theme.colors.primary }]}>
            {habits.length}
          </Text>
          <Text style={[styles.habitStatLabel, { color: theme.colors.textSecondary }]}>
            习惯数量
          </Text>
        </View>
        <View style={styles.habitStatItem}>
          <Text style={[styles.habitStatValue, { color: '#10b981' }]}>
            {habitCompletionRate}%
          </Text>
          <Text style={[styles.habitStatLabel, { color: theme.colors.textSecondary }]}>
            平均完成率
          </Text>
        </View>
        <View style={styles.habitStatItem}>
          <Text style={[styles.habitStatValue, { color: '#f59e0b' }]}>
            {streakDays}
          </Text>
          <Text style={[styles.habitStatLabel, { color: theme.colors.textSecondary }]}>
            连续天数
          </Text>
        </View>
      </View>
    </View>
  );

  const renderInsights = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>智能洞察</Text>
      <View style={styles.insightsList}>
        <View style={[styles.insightCard, { backgroundColor: theme.colors.primary + '10' }]}>
          <MaterialIcons name="lightbulb" size={24} color={theme.colors.warning} style={{ marginRight: 12 }} />
          <View style={styles.insightContent}>
            <Text style={[styles.insightTitle, { color: theme.colors.text }]}>
              完成效率
            </Text>
            <Text style={[styles.insightText, { color: theme.colors.textSecondary }]}>
              {completedTasks.length > 0
                ? `您已完成${completedTasks.length}个任务，平均完成时间为${averageCompletionTime}`
                : '开始完成任务以获取洞察'}
            </Text>
          </View>
        </View>
        
        <View style={[styles.insightCard, { backgroundColor: '#10b98110' }]}>
          <MaterialIcons name="local-fire-department" size={24} color="#f97316" style={{ marginRight: 12 }} />
          <View style={styles.insightContent}>
            <Text style={[styles.insightTitle, { color: theme.colors.text }]}>
              坚持不懈
            </Text>
            <Text style={[styles.insightText, { color: theme.colors.textSecondary }]}>
              {streakDays > 0
                ? `您已连续${streakDays}天完成任务，继续保持！`
                : '今天完成任务，开启您的连续记录'}
            </Text>
          </View>
        </View>
        
        {overdueTasks.length > 0 && (
          <View style={[styles.insightCard, { backgroundColor: '#ef444410' }]}>
            <MaterialIcons name="warning" size={24} color={theme.colors.error} style={{ marginRight: 12 }} />
            <View style={styles.insightContent}>
              <Text style={[styles.insightTitle, { color: theme.colors.text }]}>
                注意逾期
              </Text>
              <Text style={[styles.insightText, { color: theme.colors.textSecondary }]}>
                您有{overdueTasks.length}个逾期任务，建议优先处理
              </Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {renderHeader()}
      
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {renderTimeRangeSelector()}
        {renderOverviewCards()}
        {renderProductivityScore()}
        {renderCompletionRate()}
        {renderTasksByStatus()}
        {renderTasksByPriority()}
        {renderDailyTrend()}
        {renderProjectDistribution()}
        {renderGoalProgress()}
        {renderHabitStats()}
        {renderInsights()}
        
        <View style={styles.bottomPadding} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
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
  timeRangeSelector: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  timeRangeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
  },
  timeRangeText: {
    fontSize: 14,
    fontWeight: '500',
  },
  overviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  overviewCard: {
    width: (width - 48) / 2,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  overviewCardValue: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  overviewCardLabel: {
    fontSize: 14,
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  scoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scoreCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 20,
  },
  scoreValue: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  scoreMax: {
    fontSize: 12,
  },
  scoreDetails: {
    flex: 1,
  },
  scoreDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  scoreIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  scoreDetailText: {
    fontSize: 14,
  },
  completionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  completionBar: {
    flex: 1,
    height: 12,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 6,
    marginRight: 12,
    overflow: 'hidden',
  },
  completionProgress: {
    height: '100%',
    borderRadius: 6,
  },
  completionText: {
    fontSize: 18,
    fontWeight: '600',
    width: 60,
    textAlign: 'right',
  },
  completionStats: {
    marginTop: 8,
  },
  completionStatText: {
    fontSize: 12,
  },
  statusChart: {
    marginTop: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 100,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    fontSize: 12,
  },
  statusBarContainer: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 4,
    marginRight: 8,
    overflow: 'hidden',
  },
  statusBar: {
    height: '100%',
    borderRadius: 4,
  },
  statusCount: {
    fontSize: 12,
    width: 30,
    textAlign: 'right',
  },
  priorityChart: {
    marginTop: 8,
  },
  priorityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  priorityLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 100,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  priorityText: {
    fontSize: 12,
  },
  priorityBarContainer: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 4,
    marginRight: 8,
    overflow: 'hidden',
  },
  priorityBar: {
    height: '100%',
    borderRadius: 4,
  },
  priorityCount: {
    fontSize: 12,
    width: 30,
    textAlign: 'right',
  },
  trendChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 150,
    marginTop: 8,
  },
  trendBar: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 2,
    height: '100%',
    justifyContent: 'flex-end',
  },
  trendValue: {
    fontSize: 10,
    marginBottom: 4,
  },
  trendBarFill: {
    width: '80%',
    borderRadius: 4,
    minHeight: 4,
  },
  trendDate: {
    fontSize: 10,
    marginTop: 4,
  },
  projectList: {
    marginTop: 8,
  },
  projectRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  projectLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  projectDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  projectText: {
    fontSize: 14,
    flex: 1,
  },
  projectCount: {
    fontSize: 12,
    marginLeft: 8,
  },
  goalRow: {
    marginBottom: 16,
  },
  goalTitle: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  goalProgressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  goalProgressBar: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 4,
    marginRight: 8,
    overflow: 'hidden',
  },
  goalProgressFill: {
    height: '100%',
    borderRadius: 4,
  },
  goalProgressText: {
    fontSize: 12,
    width: 45,
    textAlign: 'right',
  },
  habitStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  habitStatItem: {
    alignItems: 'center',
  },
  habitStatValue: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  habitStatLabel: {
    fontSize: 12,
  },
  insightsList: {
    marginTop: 8,
  },
  insightCard: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  insightIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  insightContent: {
    flex: 1,
  },
  insightTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  insightText: {
    fontSize: 13,
    lineHeight: 18,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
  },
  bottomPadding: {
    height: 40,
  },
});
