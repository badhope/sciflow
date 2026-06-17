import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  SafeAreaView,
  Platform,
  Dimensions,
  Linking,
  Share,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DateTimePicker from '@react-native-community/datetimepicker';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../src/shared/store';
import { RootStackParamList, Priority, TaskStatus, Task } from '../src/shared/types';
import { Button } from '../src/shared/components/common';
import { toast } from '../src/shared/components/common/Toast';
import { Pomodoro } from '../src/shared/components/common/Pomodoro';
import { MentionInput, renderMentionText, type MentionUser } from '../src/shared/components/common/MentionInput';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'TaskDetail'>;
type RouteType = RouteProp<RootStackParamList, 'TaskDetail'>;

const { width } = Dimensions.get('window');

const MENTION_USERS: MentionUser[] = [
  { id: 'current-user', name: '当前用户', username: 'me', color: '#3b82f6' },
  { id: 'u-alice', name: 'Alice', username: 'alice', color: '#ec4899' },
  { id: 'u-bob', name: 'Bob', username: 'bob', color: '#10b981' },
  { id: 'u-carol', name: 'Carol', username: 'carol', color: '#f59e0b' },
  { id: 'u-david', name: 'David', username: 'david', color: '#8b5cf6' },
  { id: 'u-eve', name: 'Eve', username: 'eve', color: '#06b6d4' },
];

export default function TaskDetailScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteType>();
  const { taskId } = route.params;

  const {
    theme,
    tasks,
    projects,
    categories,
    tags,
    addTask,
    updateTask,
    deleteTask,
    toggleTaskComplete,
    removeTagFromTask,
    addSubtask,
    updateSubtask,
    deleteSubtask,
    addComment,
    addChecklistItem,
    toggleChecklistItem,
    deleteChecklistItem,
  } = useAppStore();

  const task = tasks.find((t) => t.id === taskId);
  const project = task?.projectId ? projects.find((p) => p.id === task.projectId) : null;
  const category = task?.categoryId ? categories.find((c) => c.id === task.categoryId) : null;

  const [isEditing, setIsEditing] = useState(true);
  const [editedTask, setEditedTask] = useState<Task | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [showSubtasks, setShowSubtasks] = useState(true);
  const [showPomodoro, setShowPomodoro] = useState(false);
  const [showChecklist, setShowChecklist] = useState(true);
  const [showComments, setShowComments] = useState(true);
  const [showAttachments, setShowAttachments] = useState(true);
  const [, setShowProjectPicker] = useState(false);
  const [, setShowCategoryPicker] = useState(false);
  const [, setShowTagPicker] = useState(false);
  const [, setShowStatusPicker] = useState(false);
  const [, setShowPriorityPicker] = useState(false);

  useEffect(() => {
    if (task) {
      setEditedTask({ ...task });
    }
  }, [task]);

  if (!task || !editedTask) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: theme.colors.text }]}>任务不存在</Text>
          <Button title="返回" onPress={() => navigation.goBack()} />
        </View>
      </SafeAreaView>
    );
  }

  const handleSave = () => {
    if (editedTask) {
      updateTask(editedTask.id, editedTask);
      setIsEditing(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      '删除任务',
      '确定要删除这个任务吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            const taskCopy = { ...task };
            deleteTask(task.id);
            navigation.goBack();
            toast.withAction('任务已删除', '撤销', () => {
              addTask(taskCopy);
              toast.success('已恢复');
            });
          },
        },
      ]
    );
  };

  const handleArchive = () => {
    updateTask(task.id, { isArchived: !task.isArchived });
    toast.success(task.isArchived ? '已取消归档' : '已归档');
  };

  const handleDuplicate = () => {
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...taskData } = task;
    const duplicatedTask: Omit<Task, 'id' | 'createdAt' | 'updatedAt'> = {
      ...taskData,
      title: `${task.title} (副本)`,
      completed: false,
      completedAt: null,
      status: 'todo',
    };
    addTask(duplicatedTask);
    toast.success('已复制任务');
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `${task.title}\n\n${task.description || ''}\n\n截止日期: ${task.dueDate?.toLocaleDateString() || '未设置'}\n优先级: ${getPriorityLabel(task.priority)}\n状态: ${getStatusLabel(task.status)}`,
        title: task.title,
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  };

  const handleAddComment = () => {
    if (newComment.trim()) {
      addComment(task.id, {
        id: `comment-${Date.now()}`,
        authorId: 'current-user',
        authorName: '当前用户',
        content: newComment.trim(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setNewComment('');
    }
  };

  const handleAddSubtask = () => {
    if (newSubtaskTitle.trim()) {
      addSubtask(task.id, {
        id: `subtask-${Date.now()}`,
        title: newSubtaskTitle.trim(),
        completed: false,
        order: task.subtasks.length,
      });
      setNewSubtaskTitle('');
    }
  };

  const handleAddChecklistItem = () => {
    if (newChecklistItem.trim()) {
      addChecklistItem(task.id, {
        id: `checklist-${Date.now()}`,
        text: newChecklistItem.trim(),
        completed: false,
        order: task.checklist.length,
      });
      setNewChecklistItem('');
    }
  };

  const handleToggleSubtaskComplete = (subtaskId: string) => {
    const subtask = task.subtasks.find((s) => s.id === subtaskId);
    if (subtask) {
      updateSubtask(task.id, subtaskId, { completed: !subtask.completed });
    }
  };

  const handleToggleChecklistItem = (itemId: string) => {
    toggleChecklistItem(task.id, itemId);
  };

  const handleDeleteSubtask = (subtaskId: string) => {
    deleteSubtask(task.id, subtaskId);
  };

  const handleDeleteChecklistItem = (itemId: string) => {
    deleteChecklistItem(task.id, itemId);
  };

  const handleRemoveTag = (tagId: string) => {
    removeTagFromTask(task.id, tagId);
  };

  const getPriorityLabel = (priority: Priority): string => {
    const labels: Record<Priority, string> = {
      low: '低',
      medium: '中',
      high: '高',
      urgent: '紧急',
      critical: '紧急且重要',
    };
    return labels[priority];
  };

  const getPriorityColor = (priority: Priority): string => {
    const colors: Record<Priority, string> = {
      low: '#10b981',
      medium: '#f59e0b',
      high: '#f97316',
      urgent: '#ef4444',
      critical: '#dc2626',
    };
    return colors[priority];
  };

  const getStatusLabel = (status: TaskStatus): string => {
    const labels: Record<TaskStatus, string> = {
      'todo': '待办',
      'in-progress': '进行中',
      'waiting': '等待中',
      'delegated': '已委托',
      'completed': '已完成',
      'cancelled': '已取消',
      'on-hold': '暂停',
    };
    return labels[status];
  };

  const getStatusColor = (status: TaskStatus): string => {
    const colors: Record<TaskStatus, string> = {
      'todo': '#6b7280',
      'in-progress': '#3b82f6',
      'waiting': '#8b5cf6',
      'delegated': '#f59e0b',
      'completed': '#10b981',
      'cancelled': '#ef4444',
      'on-hold': '#6b7280',
    };
    return colors[status];
  };

  const completedSubtasks = task.subtasks.filter((s) => s.completed).length;
  const totalSubtasks = task.subtasks.length;
  const checklistProgress = task.checklist.length > 0
    ? (task.checklist.filter((c) => c.completed).length / task.checklist.length) * 100
    : 0;

  const renderHeader = () => (
    <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
        <MaterialIcons name="arrow-back" size={24} color={theme.colors.primary} />
      </TouchableOpacity>
      <View style={styles.headerActions}>
        <TouchableOpacity
          onPress={() => setShowPomodoro(true)}
          style={[styles.headerIconBtn, { backgroundColor: theme.colors.primary + '14' }]}
        >
          <MaterialIcons name="timer" size={18} color={theme.colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleShare} style={styles.headerButton}>
          <Text style={[styles.headerButtonText, { color: theme.colors.primary }]}>分享</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleDuplicate} style={styles.headerButton}>
          <Text style={[styles.headerButtonText, { color: theme.colors.primary }]}>复制</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleArchive} style={styles.headerButton}>
          <Text style={[styles.headerButtonText, { color: theme.colors.primary }]}>
            {task.isArchived ? '取消归档' : '归档'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleDelete} style={styles.headerButton}>
          <Text style={[styles.headerButtonText, { color: theme.colors.error }]}>删除</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderTitle = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <TextInput
        style={[
          styles.titleInput,
          { color: theme.colors.text, fontSize: 24, fontWeight: 'bold' },
        ]}
        value={editedTask.title}
        onChangeText={(text) => setEditedTask({ ...editedTask, title: text })}
        placeholder="任务标题"
        placeholderTextColor={theme.colors.textSecondary}
        multiline
        editable={isEditing}
        onBlur={handleSave}
      />
      <View style={styles.quickStatus}>
        <TouchableOpacity
          style={[styles.statusBadge, { backgroundColor: getStatusColor(task.status) }]}
          onPress={() => !isEditing && setShowStatusPicker(true)}
        >
          <Text style={styles.statusBadgeText}>{getStatusLabel(task.status)}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.priorityBadge, { backgroundColor: getPriorityColor(task.priority) }]}
          onPress={() => !isEditing && setShowPriorityPicker(true)}
        >
          <Text style={styles.priorityBadgeText}>{getPriorityLabel(task.priority)}</Text>
        </TouchableOpacity>
        {task.isStarred && <MaterialIcons name="star" size={18} color="#F59E0B" style={styles.starIcon} />}
        {task.isRecurring && <MaterialIcons name="loop" size={18} color={theme.colors.info} style={styles.recurringIcon} />}
      </View>
    </View>
  );

  const renderDescription = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>描述</Text>
      <TextInput
        style={[styles.descriptionInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
        value={editedTask.description}
        onChangeText={(text) => setEditedTask({ ...editedTask, description: text })}
        placeholder="添加任务描述..."
        placeholderTextColor={theme.colors.textSecondary}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        editable={isEditing}
        onBlur={handleSave}
      />
    </View>
  );

  const renderDates = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>日期与时间</Text>
      
      <TouchableOpacity style={styles.dateRow} onPress={() => setShowDatePicker(true)}>
        <Text style={[styles.dateLabel, { color: theme.colors.textSecondary }]}>截止日期</Text>
        <Text style={[styles.dateValue, { color: theme.colors.text }]}>
          {editedTask.dueDate?.toLocaleDateString() || '未设置'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.dateRow} onPress={() => setShowTimePicker(true)}>
        <Text style={[styles.dateLabel, { color: theme.colors.textSecondary }]}>截止时间</Text>
        <Text style={[styles.dateValue, { color: theme.colors.text }]}>
          {editedTask.dueTime ? editedTask.dueTime.toLocaleTimeString() : '未设置'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.dateRow}>
        <Text style={[styles.dateLabel, { color: theme.colors.textSecondary }]}>开始日期</Text>
        <Text style={[styles.dateValue, { color: theme.colors.text }]}>
          {editedTask.startDate?.toLocaleDateString() || '未设置'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.dateRow}>
        <Text style={[styles.dateLabel, { color: theme.colors.textSecondary }]}>提醒时间</Text>
        <Text style={[styles.dateValue, { color: theme.colors.text }]}>
          {editedTask.reminderDate?.toLocaleDateString() || '未设置'}
        </Text>
      </TouchableOpacity>

      {showDatePicker && (
        <DateTimePicker
          value={editedTask.dueDate || new Date()}
          mode="date"
          display="default"
          onChange={(event, date) => {
            setShowDatePicker(false);
            if (date) {
              setEditedTask({ ...editedTask, dueDate: date });
              updateTask(task.id, { dueDate: date });
            }
          }}
        />
      )}

      {showTimePicker && (
        <DateTimePicker
          value={editedTask.dueTime || new Date()}
          mode="time"
          display="default"
          onChange={(event, time) => {
            setShowTimePicker(false);
            if (time) {
              setEditedTask({ ...editedTask, dueTime: time });
              updateTask(task.id, { dueTime: time });
            }
          }}
        />
      )}
    </View>
  );

  const renderProject = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>项目</Text>
      <TouchableOpacity style={styles.pickerRow} onPress={() => setShowProjectPicker(true)}>
        <Text style={[styles.pickerLabel, { color: theme.colors.textSecondary }]}>所属项目</Text>
        <View style={styles.pickerValue}>
          <Text style={[styles.pickerText, { color: project?.color || theme.colors.primary }]}>
            {project?.name || '无项目'}
          </Text>
          <Text style={[styles.pickerArrow, { color: theme.colors.textSecondary }]}>›</Text>
        </View>
      </TouchableOpacity>
    </View>
  );

  const renderCategory = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>分类</Text>
      <TouchableOpacity style={styles.pickerRow} onPress={() => setShowCategoryPicker(true)}>
        <Text style={[styles.pickerLabel, { color: theme.colors.textSecondary }]}>所属分类</Text>
        <View style={styles.pickerValue}>
          <Text style={[styles.pickerText, { color: category?.color || theme.colors.primary }]}>
            {category?.name || '无分类'}
          </Text>
          <Text style={[styles.pickerArrow, { color: theme.colors.textSecondary }]}>›</Text>
        </View>
      </TouchableOpacity>
    </View>
  );

  const renderTags = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>标签</Text>
        <TouchableOpacity onPress={() => setShowTagPicker(true)}>
          <Text style={[styles.addButton, { color: theme.colors.primary }]}>+ 添加</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.tagsContainer}>
        {task.tags.map((tagId) => {
          const tag = tags.find((t) => t.id === tagId);
          return tag ? (
            <TouchableOpacity
              key={tag.id}
              style={[styles.tag, { backgroundColor: tag.color + '20' }]}
              onLongPress={() => handleRemoveTag(tag.id)}
            >
              <Text style={[styles.tagText, { color: tag.color }]}>{tag.name}</Text>
              <TouchableOpacity onPress={() => handleRemoveTag(tag.id)}>
                <Text style={[styles.tagRemove, { color: tag.color }]}>×</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ) : null;
        })}
        {task.tags.length === 0 && (
          <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
            暂无标签，点击添加
          </Text>
        )}
      </View>
    </View>
  );

  const renderSubtasks = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <TouchableOpacity style={styles.sectionHeader} onPress={() => setShowSubtasks(!showSubtasks)}>
        <View style={styles.sectionHeaderLeft}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>子任务</Text>
          <Text style={[styles.progressText, { color: theme.colors.textSecondary }]}>
            {completedSubtasks}/{totalSubtasks}
          </Text>
        </View>
        <Text style={[styles.expandIcon, { color: theme.colors.textSecondary }]}>
          {showSubtasks ? <MaterialIcons name="expand-less" size={16} color={theme.colors.textSecondary} /> : <MaterialIcons name="expand-more" size={16} color={theme.colors.textSecondary} />}
        </Text>
      </TouchableOpacity>

      {showSubtasks && (
        <>
          <View style={styles.progressBarContainer}>
            <View
              style={[
                styles.progressBar,
                {
                  backgroundColor: theme.colors.primary,
                  width: `${totalSubtasks > 0 ? (completedSubtasks / totalSubtasks) * 100 : 0}%`,
                },
              ]}
            />
          </View>

          {task.subtasks.map((subtask) => (
            <View key={subtask.id} style={styles.subtaskRow}>
              <TouchableOpacity
                style={styles.checkbox}
                onPress={() => handleToggleSubtaskComplete(subtask.id)}
              >
                <View
                  style={[
                    styles.checkboxInner,
                    {
                      backgroundColor: subtask.completed ? theme.colors.primary : 'transparent',
                      borderColor: subtask.completed ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  {subtask.completed && <MaterialIcons name="check" size={12} color="#FFFFFF" />}
                </View>
              </TouchableOpacity>
              <Text
                style={[
                  styles.subtaskTitle,
                  {
                    color: subtask.completed ? theme.colors.textSecondary : theme.colors.text,
                    textDecorationLine: subtask.completed ? 'line-through' : 'none',
                  },
                ]}
              >
                {subtask.title}
              </Text>
              <TouchableOpacity onPress={() => handleDeleteSubtask(subtask.id)}>
                <MaterialIcons name="delete" size={18} color={theme.colors.error} />
              </TouchableOpacity>
            </View>
          ))}

          <View style={styles.addSubtaskRow}>
            <TextInput
              style={[styles.addSubtaskInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
              value={newSubtaskTitle}
              onChangeText={setNewSubtaskTitle}
              placeholder="添加子任务..."
              placeholderTextColor={theme.colors.textSecondary}
              onSubmitEditing={handleAddSubtask}
            />
            <TouchableOpacity style={styles.addSubtaskButton} onPress={handleAddSubtask}>
              <Text style={[styles.addSubtaskButtonText, { color: theme.colors.primary }]}>添加</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );

  const renderChecklist = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <TouchableOpacity style={styles.sectionHeader} onPress={() => setShowChecklist(!showChecklist)}>
        <View style={styles.sectionHeaderLeft}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>清单</Text>
          <Text style={[styles.progressText, { color: theme.colors.textSecondary }]}>
            {checklistProgress.toFixed(0)}%
          </Text>
        </View>
        <Text style={[styles.expandIcon, { color: theme.colors.textSecondary }]}>
          {showChecklist ? <MaterialIcons name="expand-less" size={16} color={theme.colors.textSecondary} /> : <MaterialIcons name="expand-more" size={16} color={theme.colors.textSecondary} />}
        </Text>
      </TouchableOpacity>

      {showChecklist && (
        <>
          <View style={styles.progressBarContainer}>
            <View
              style={[
                styles.progressBar,
                {
                  backgroundColor: theme.colors.success,
                  width: `${checklistProgress}%`,
                },
              ]}
            />
          </View>

          {task.checklist.map((item) => (
            <View key={item.id} style={styles.checklistRow}>
              <TouchableOpacity
                style={styles.checkbox}
                onPress={() => handleToggleChecklistItem(item.id)}
              >
                <View
                  style={[
                    styles.checkboxInner,
                    {
                      backgroundColor: item.completed ? theme.colors.success : 'transparent',
                      borderColor: item.completed ? theme.colors.success : theme.colors.border,
                    },
                  ]}
                >
                  {item.completed && <MaterialIcons name="check" size={12} color="#FFFFFF" />}
                </View>
              </TouchableOpacity>
              <Text
                style={[
                  styles.checklistText,
                  {
                    color: item.completed ? theme.colors.textSecondary : theme.colors.text,
                    textDecorationLine: item.completed ? 'line-through' : 'none',
                  },
                ]}
              >
                {item.text}
              </Text>
              <TouchableOpacity onPress={() => handleDeleteChecklistItem(item.id)}>
                <MaterialIcons name="delete" size={18} color={theme.colors.error} />
              </TouchableOpacity>
            </View>
          ))}

          <View style={styles.addSubtaskRow}>
            <TextInput
              style={[styles.addSubtaskInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
              value={newChecklistItem}
              onChangeText={setNewChecklistItem}
              placeholder="添加清单项..."
              placeholderTextColor={theme.colors.textSecondary}
              onSubmitEditing={handleAddChecklistItem}
            />
            <TouchableOpacity style={styles.addSubtaskButton} onPress={handleAddChecklistItem}>
              <Text style={[styles.addSubtaskButtonText, { color: theme.colors.primary }]}>添加</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );

  const renderComments = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <TouchableOpacity style={styles.sectionHeader} onPress={() => setShowComments(!showComments)}>
        <View style={styles.sectionHeaderLeft}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>评论</Text>
          <Text style={[styles.progressText, { color: theme.colors.textSecondary }]}>
            {task.comments.length}
          </Text>
        </View>
        <Text style={[styles.expandIcon, { color: theme.colors.textSecondary }]}>
          {showComments ? <MaterialIcons name="expand-less" size={16} color={theme.colors.textSecondary} /> : <MaterialIcons name="expand-more" size={16} color={theme.colors.textSecondary} />}
        </Text>
      </TouchableOpacity>

      {showComments && (
        <>
          {task.comments.map((comment) => (
            <View key={comment.id} style={styles.commentRow}>
              <View style={[styles.commentAvatar, { backgroundColor: theme.colors.primary }]}>
                <Text style={styles.commentAvatarText}>{comment.authorName[0]}</Text>
              </View>
              <View style={styles.commentContent}>
                <View style={styles.commentHeader}>
                  <Text style={[styles.commentAuthor, { color: theme.colors.text }]}>
                    {comment.authorName}
                  </Text>
                  <Text style={[styles.commentTime, { color: theme.colors.textSecondary }]}>
                    {comment.createdAt.toLocaleString()}
                  </Text>
                </View>
                {renderMentionText(
                  comment.content,
                  theme,
                  { color: theme.colors.text, fontSize: 14, lineHeight: 20 }
                )}
              </View>
            </View>
          ))}

          <MentionInput
            value={newComment}
            onChange={setNewComment}
            onSubmit={handleAddComment}
            users={MENTION_USERS}
            placeholder="添加评论，使用 @ 提及成员"
            style={{ marginTop: 12 }}
          />
        </>
      )}
    </View>
  );

  const renderAttachments = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <TouchableOpacity style={styles.sectionHeader} onPress={() => setShowAttachments(!showAttachments)}>
        <View style={styles.sectionHeaderLeft}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>附件</Text>
          <Text style={[styles.progressText, { color: theme.colors.textSecondary }]}>
            {task.attachments.length}
          </Text>
        </View>
        <Text style={[styles.expandIcon, { color: theme.colors.textSecondary }]}>
          {showAttachments ? <MaterialIcons name="expand-less" size={16} color={theme.colors.textSecondary} /> : <MaterialIcons name="expand-more" size={16} color={theme.colors.textSecondary} />}
        </Text>
      </TouchableOpacity>

      {showAttachments && (
        <>
          {task.attachments.length > 0 ? (
            <View style={styles.attachmentsGrid}>
              {task.attachments.map((attachment) => (
                <TouchableOpacity
                  key={attachment.id}
                  style={[styles.attachmentCard, { backgroundColor: theme.colors.background }]}
                  onPress={() => Linking.openURL(attachment.uri)}
                >
                  <Text style={styles.attachmentIcon}>
                    {attachment.type === 'image' ? (
                      <MaterialIcons name="image" size={32} color={theme.colors.primary} />
                    ) : attachment.type === 'document' ? (
                      <MaterialIcons name="description" size={32} color={theme.colors.primary} />
                    ) : attachment.type === 'video' ? (
                      <MaterialIcons name="videocam" size={32} color={theme.colors.primary} />
                    ) : attachment.type === 'audio' ? (
                      <MaterialIcons name="audiotrack" size={32} color={theme.colors.primary} />
                    ) : (
                      <MaterialIcons name="attachment" size={32} color={theme.colors.primary} />
                    )}
                  </Text>
                  <Text
                    style={[styles.attachmentName, { color: theme.colors.text }]}
                    numberOfLines={2}
                  >
                    {attachment.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
              暂无附件
            </Text>
          )}
        </>
      )}
    </View>
  );

  const renderTimeEstimate = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>时间估算</Text>
      <View style={styles.timeRow}>
        <View style={styles.timeItem}>
          <Text style={[styles.timeLabel, { color: theme.colors.textSecondary }]}>预计时间</Text>
          <TextInput
            style={[styles.timeInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
            value={editedTask.estimatedTime?.toString() || ''}
            onChangeText={(text) => setEditedTask({ ...editedTask, estimatedTime: parseInt(text) || null })}
            placeholder="分钟"
            placeholderTextColor={theme.colors.textSecondary}
            keyboardType="numeric"
            onBlur={handleSave}
          />
        </View>
        <View style={styles.timeItem}>
          <Text style={[styles.timeLabel, { color: theme.colors.textSecondary }]}>实际时间</Text>
          <TextInput
            style={[styles.timeInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
            value={editedTask.actualTime?.toString() || ''}
            onChangeText={(text) => setEditedTask({ ...editedTask, actualTime: parseInt(text) || null })}
            placeholder="分钟"
            placeholderTextColor={theme.colors.textSecondary}
            keyboardType="numeric"
            onBlur={handleSave}
          />
        </View>
      </View>
    </View>
  );

  const renderMetadata = () => (
    <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>信息</Text>
      <View style={styles.metadataRow}>
        <Text style={[styles.metadataLabel, { color: theme.colors.textSecondary }]}>创建时间</Text>
        <Text style={[styles.metadataValue, { color: theme.colors.text }]}>
          {task.createdAt.toLocaleString()}
        </Text>
      </View>
      <View style={styles.metadataRow}>
        <Text style={[styles.metadataLabel, { color: theme.colors.textSecondary }]}>更新时间</Text>
        <Text style={[styles.metadataValue, { color: theme.colors.text }]}>
          {task.updatedAt.toLocaleString()}
        </Text>
      </View>
      {task.completedAt && (
        <View style={styles.metadataRow}>
          <Text style={[styles.metadataLabel, { color: theme.colors.textSecondary }]}>完成时间</Text>
          <Text style={[styles.metadataValue, { color: theme.colors.text }]}>
            {task.completedAt.toLocaleString()}
          </Text>
        </View>
      )}
      <View style={styles.metadataRow}>
        <Text style={[styles.metadataLabel, { color: theme.colors.textSecondary }]}>任务ID</Text>
        <Text style={[styles.metadataValue, { color: theme.colors.text }]}>{task.id}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {renderHeader()}
      
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {renderTitle()}
        {renderDescription()}
        {renderDates()}
        {renderProject()}
        {renderCategory()}
        {renderTags()}
        {renderSubtasks()}
        {renderChecklist()}
        {renderTimeEstimate()}
        {renderComments()}
        {renderAttachments()}
        {renderMetadata()}
        
        <View style={styles.bottomPadding} />
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }]}>
        <Button
          title={isEditing ? '保存' : '编辑'}
          onPress={isEditing ? handleSave : () => setIsEditing(true)}
          variant={isEditing ? 'primary' : 'secondary'}
          style={styles.footerButton}
        />
        <Button
          title={task.completed ? '标记未完成' : '标记完成'}
          onPress={() => toggleTaskComplete(task.id)}
          variant={task.completed ? 'secondary' : 'primary'}
          style={styles.footerButton}
        />
      </View>

      <Pomodoro
        visible={showPomodoro}
        onClose={() => setShowPomodoro(false)}
        taskTitle={task.title}
        onComplete={() => {
          updateTask(task.id, { progress: Math.min(100, (task.progress || 0) + 25) });
          toast.success('完成一个专注回合 🎯');
        }}
      />
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
  headerButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  headerButtonText: {
    fontSize: 14,
  },
  headerActions: {
    flexDirection: 'row',
  },
  section: {
    marginHorizontal: 16,
    marginTop: 16,
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
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  titleInput: {
    padding: 0,
    marginBottom: 8,
  },
  quickStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 8,
  },
  statusBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  priorityBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 8,
  },
  priorityBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  starIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  recurringIcon: {
    fontSize: 16,
  },
  descriptionInput: {
    minHeight: 100,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    fontSize: 14,
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  dateLabel: {
    fontSize: 14,
  },
  dateValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  pickerLabel: {
    fontSize: 14,
  },
  pickerValue: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pickerText: {
    fontSize: 14,
    fontWeight: '500',
  },
  pickerArrow: {
    fontSize: 18,
    marginLeft: 8,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 8,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '500',
  },
  tagRemove: {
    fontSize: 16,
    marginLeft: 4,
  },
  addButton: {
    fontSize: 14,
    fontWeight: '600',
  },
  progressBarContainer: {
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 2,
    marginBottom: 12,
  },
  progressBar: {
    height: '100%',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 14,
    marginLeft: 8,
  },
  expandIcon: {
    fontSize: 12,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  checkbox: {
    marginRight: 12,
  },
  checkboxInner: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  subtaskTitle: {
    flex: 1,
    fontSize: 14,
  },
  deleteIcon: {
    fontSize: 16,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  checklistText: {
    flex: 1,
    fontSize: 14,
  },
  addSubtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  addSubtaskInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    marginRight: 8,
  },
  addSubtaskButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  addSubtaskButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  commentRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  commentAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  commentAvatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  commentContent: {
    flex: 1,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  commentAuthor: {
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,
  },
  commentTime: {
    fontSize: 12,
  },
  commentText: {
    fontSize: 14,
    lineHeight: 20,
  },
  addCommentRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 8,
  },
  addCommentInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    minHeight: 40,
    marginRight: 8,
  },
  addCommentButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  addCommentButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  attachmentsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  attachmentCard: {
    width: (width - 64) / 3,
    margin: 4,
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  attachmentIcon: {
    fontSize: 32,
    marginBottom: 4,
  },
  attachmentName: {
    fontSize: 10,
    textAlign: 'center',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeItem: {
    flex: 1,
    marginHorizontal: 4,
  },
  timeLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  timeInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  metadataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  metadataLabel: {
    fontSize: 12,
  },
  metadataValue: {
    fontSize: 12,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 16,
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
  },
  footerButton: {
    flex: 1,
    marginHorizontal: 4,
  },
  bottomPadding: {
    height: 100,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    marginBottom: 20,
  },
});
