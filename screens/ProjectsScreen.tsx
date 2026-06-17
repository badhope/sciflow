import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  Platform,
  Alert,
  Modal,
  ScrollView,
  Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../src/shared/store';
import { RootStackParamList, Project } from '../src/shared/types';
import { Button } from '../src/shared/components/common';
import { toast } from '../src/shared/components/common/Toast';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Projects'>;

const { width } = Dimensions.get('window');

const PROJECT_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#6b7280', '#1f2937', '#000000',
];

const PROJECT_ICONS = [
  'work', 'assignment', 'track-changes', 'lightbulb', 'rocket', 'library-books', 'palette', 'computer',
  'home', 'flight', 'sports-esports', 'music-note', 'camera-alt', 'movie', 'phone-android', 'keyboard',
  'desktop-windows', 'build', 'settings', 'vpn-key', 'folder', 'push-pin', 'emoji-events', 'star',
];

export default function ProjectsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const {
    theme,
    projects,
    addProject,
    updateProject,
    deleteProject,
    tasks,
  } = useAppStore();

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [newProject, setNewProject] = useState<Partial<Project>>({
    name: '',
    description: '',
    color: '#3b82f6',
    icon: 'work',
    isDefault: false,
    isFavorite: false,
    isArchived: false,
    status: 'active',
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showArchived, setShowArchived] = useState(false);

  const getProjectTaskCount = (projectId: string): number => {
    return tasks.filter((task) => task.projectId === projectId && !task.isDeleted).length;
  };

  const getProjectCompletedCount = (projectId: string): number => {
    return tasks.filter((task) => task.projectId === projectId && task.completed && !task.isDeleted).length;
  };

  const filteredProjects = projects.filter((project) => {
    if (!showArchived && project.isArchived) return false;
    return project.name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const activeProjects = filteredProjects.filter((p) => !p.isArchived);
  const archivedProjects = filteredProjects.filter((p) => p.isArchived);
  const favoriteProjects = filteredProjects.filter((p) => p.isFavorite && !p.isArchived);

  const handleAddProject = () => {
    if (!newProject.name?.trim()) {
      toast.error('请输入项目名称');
      return;
    }

    const project: Project = {
      id: `project-${Date.now()}`,
      name: newProject.name.trim(),
      description: newProject.description || '',
      color: newProject.color || '#3b82f6',
      icon: newProject.icon || 'work',
      isDefault: newProject.isDefault || false,
      isFavorite: newProject.isFavorite || false,
      isArchived: false,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      taskCount: 0,
      completedTaskCount: 0,
      progress: 0,
      startDate: null,
      dueDate: null,
      ownerId: null,
      tags: [],
      location: null,
    };

    addProject(project);
    setShowAddModal(false);
    setNewProject({
      name: '',
      description: '',
      color: '#3b82f6',
      icon: 'work',
      isDefault: false,
      isFavorite: false,
      isArchived: false,
      status: 'active',
    });
    toast.success('项目已创建');
  };

  const handleUpdateProject = () => {
    if (!selectedProject || !newProject.name?.trim()) return;

    updateProject(selectedProject.id, {
      name: newProject.name.trim(),
      description: newProject.description,
      color: newProject.color,
      icon: newProject.icon,
      isDefault: newProject.isDefault,
      isFavorite: newProject.isFavorite,
      status: newProject.status,
    });

    setShowEditModal(false);
    setSelectedProject(null);
    toast.success('项目已更新');
  };

  const handleDeleteProject = (projectId: string) => {
    const taskCount = getProjectTaskCount(projectId);
    
    Alert.alert(
      '删除项目',
      taskCount > 0
        ? `此项目下有 ${taskCount} 个任务，删除后这些任务将移至"无项目"。确定要删除吗？`
        : '确定要删除这个项目吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => deleteProject(projectId),
        },
      ]
    );
  };

  const handleToggleFavorite = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      updateProject(projectId, { isFavorite: !project.isFavorite });
    }
  };

  const handleToggleArchive = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      updateProject(projectId, { isArchived: !project.isArchived });
      Alert.alert('成功', project.isArchived ? '项目已取消归档' : '项目已归档');
    }
  };

  const handleViewProject = (_projectId: string) => {
    navigation.navigate('Home');
  };

  const openEditModal = (project: Project) => {
    setSelectedProject(project);
    setNewProject({
      name: project.name,
      description: project.description,
      color: project.color,
      icon: project.icon,
      isDefault: project.isDefault,
      isFavorite: project.isFavorite,
      status: project.status,
    });
    setShowEditModal(true);
  };

  const renderProjectCard = (project: Project) => {
    const taskCount = getProjectTaskCount(project.id);
    const completedCount = getProjectCompletedCount(project.id);
    const completionRate = taskCount > 0 ? (completedCount / taskCount) * 100 : 0;

    return (
      <TouchableOpacity
        key={project.id}
        style={[styles.projectCard, { backgroundColor: theme.colors.surface }]}
        onPress={() => handleViewProject(project.id)}
        onLongPress={() => {
          Alert.alert(project.name, '选择操作', [
            { text: '编辑', onPress: () => openEditModal(project) },
            { text: project.isFavorite ? '取消收藏' : '收藏', onPress: () => handleToggleFavorite(project.id) },
            { text: project.isArchived ? '取消归档' : '归档', onPress: () => handleToggleArchive(project.id) },
            { text: '删除', style: 'destructive', onPress: () => handleDeleteProject(project.id) },
            { text: '取消', style: 'cancel' },
          ]);
        }}
      >
        <View style={styles.projectHeader}>
          <View style={[styles.projectIcon, { backgroundColor: project.color + '20' }]}>
            <MaterialIcons name={project.icon as any} size={20} color={project.color} />
          </View>
          <View style={styles.projectActions}>
            {project.isFavorite && <MaterialIcons name="star" size={18} color="#F59E0B" style={{ marginRight: 8 }} />}
            <TouchableOpacity
              onPress={() => handleToggleFavorite(project.id)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialIcons name={project.isFavorite ? 'star' : 'star-border'} size={20} color={project.isFavorite ? '#F59E0B' : theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[styles.projectName, { color: theme.colors.text }]} numberOfLines={2}>
          {project.name}
        </Text>

        {project.description && (
          <Text style={[styles.projectDescription, { color: theme.colors.textSecondary }]} numberOfLines={2}>
            {project.description}
          </Text>
        )}

        <View style={styles.projectStats}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.colors.primary }]}>{taskCount}</Text>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>任务</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: '#10b981' }]}>{completedCount}</Text>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>已完成</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.colors.text }]}>{completionRate.toFixed(0)}%</Text>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>进度</Text>
          </View>
        </View>

        <View style={styles.progressBarContainer}>
          <View
            style={[
              styles.progressBar,
              {
                backgroundColor: project.color,
                width: `${completionRate}%`,
              },
            ]}
          />
        </View>

        <View style={styles.projectFooter}>
          <View style={[styles.statusBadge, {
            backgroundColor: project.status === 'active' ? '#10b98120' : 
                           project.status === 'completed' ? '#3b82f620' : '#6b728020',
          }]}>
            <Text style={[styles.statusText, {
              color: project.status === 'active' ? '#10b981' : 
                     project.status === 'completed' ? '#3b82f6' : '#6b7280',
            }]}>
              {project.status === 'active' ? '进行中' : 
               project.status === 'completed' ? '已完成' : '已暂停'}
            </Text>
          </View>
          <Text style={[styles.projectDate, { color: theme.colors.textSecondary }]}>
            {new Date(project.createdAt).toLocaleDateString()}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderProjectListItem = (project: Project) => {
    const taskCount = getProjectTaskCount(project.id);
    const completedCount = getProjectCompletedCount(project.id);

    return (
      <TouchableOpacity
        key={project.id}
        style={[styles.projectListItem, { backgroundColor: theme.colors.surface }]}
        onPress={() => handleViewProject(project.id)}
        onLongPress={() => {
          Alert.alert(project.name, '选择操作', [
            { text: '编辑', onPress: () => openEditModal(project) },
            { text: project.isFavorite ? '取消收藏' : '收藏', onPress: () => handleToggleFavorite(project.id) },
            { text: project.isArchived ? '取消归档' : '归档', onPress: () => handleToggleArchive(project.id) },
            { text: '删除', style: 'destructive', onPress: () => handleDeleteProject(project.id) },
            { text: '取消', style: 'cancel' },
          ]);
        }}
      >
        <View style={[styles.projectColorBar, { backgroundColor: project.color }]} />
        <View style={styles.projectListContent}>
          <View style={styles.projectListHeader}>
            <Text style={styles.projectListIcon}>
              <MaterialIcons name={project.icon as any} size={24} color={project.color} />
            </Text>
            <View style={styles.projectListInfo}>
              <Text style={[styles.projectListName, { color: theme.colors.text }]}>
                {project.name}
              </Text>
              {project.description && (
                <Text style={[styles.projectListDescription, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                  {project.description}
                </Text>
              )}
            </View>
            {project.isFavorite && <MaterialIcons name="star" size={18} color="#F59E0B" style={{ marginLeft: 8 }} />}
          </View>
          <View style={styles.projectListStats}>
            <Text style={[styles.projectListStatText, { color: theme.colors.textSecondary }]}>
              {taskCount} 个任务 · {completedCount} 已完成
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderHeader = () => (
    <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
        <MaterialIcons name="arrow-back" size={24} color={theme.colors.primary} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: theme.colors.text }]}>项目管理</Text>
      <TouchableOpacity onPress={() => setShowAddModal(true)} style={styles.addButton}>
        <Text style={[styles.addButtonText, { color: theme.colors.primary }]}>+ 新建</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSearchBar = () => (
    <View style={[styles.searchBar, { backgroundColor: theme.colors.surface }]}>
      <View style={[styles.searchInputContainer, { backgroundColor: theme.colors.background }]}>
        <MaterialIcons name="search" size={16} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
        <TextInput
          style={[styles.searchInput, { color: theme.colors.text }]}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="搜索项目..."
          placeholderTextColor={theme.colors.textSecondary}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <MaterialIcons name="close" size={20} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity
        style={styles.viewModeButton}
        onPress={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
      >
        <MaterialIcons name={viewMode === 'grid' ? 'format-list-bulleted' : 'grid-view'} size={20} color={theme.colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.archiveButton, showArchived && { backgroundColor: theme.colors.primary }]}
        onPress={() => setShowArchived(!showArchived)}
      >
        <MaterialIcons name="archive" size={20} color={showArchived ? '#FFFFFF' : theme.colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );

  const renderColorPicker = (selectedColor: string, onColorSelect: (color: string) => void) => (
    <View style={styles.pickerSection}>
      <Text style={[styles.pickerLabel, { color: theme.colors.text }]}>选择颜色</Text>
      <View style={styles.colorGrid}>
        {PROJECT_COLORS.map((color) => (
          <TouchableOpacity
            key={color}
            style={[
              styles.colorOption,
              { backgroundColor: color },
              selectedColor === color && styles.colorOptionSelected,
            ]}
            onPress={() => onColorSelect(color)}
          >
            {selectedColor === color && <MaterialIcons name="check" size={18} color="#FFFFFF" />}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderIconPicker = (selectedIcon: string, onIconSelect: (icon: string) => void) => (
    <View style={styles.pickerSection}>
      <Text style={[styles.pickerLabel, { color: theme.colors.text }]}>选择图标</Text>
      <View style={styles.iconGrid}>
        {PROJECT_ICONS.map((icon) => (
          <TouchableOpacity
            key={icon}
            style={[
              styles.iconOption,
              selectedIcon === icon && { backgroundColor: theme.colors.primary + '20' },
            ]}
            onPress={() => onIconSelect(icon)}
          >
            <MaterialIcons name={icon as any} size={24} color={selectedIcon === icon ? theme.colors.primary : theme.colors.textSecondary} />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderAddModal = () => (
    <Modal
      visible={showAddModal}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowAddModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>创建项目</Text>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <MaterialIcons name="close" size={24} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>项目名称 *</Text>
              <TextInput
                style={[styles.formInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newProject.name}
                onChangeText={(text) => setNewProject({ ...newProject, name: text })}
                placeholder="例如：产品开发、市场推广"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>描述</Text>
              <TextInput
                style={[styles.formInput, styles.formTextArea, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newProject.description}
                onChangeText={(text) => setNewProject({ ...newProject, description: text })}
                placeholder="项目描述..."
                placeholderTextColor={theme.colors.textSecondary}
                multiline
                numberOfLines={3}
              />
            </View>

            {renderColorPicker(newProject.color || '#3b82f6', (color) =>
              setNewProject({ ...newProject, color })
            )}

            {renderIconPicker(newProject.icon || 'work', (icon) =>
              setNewProject({ ...newProject, icon })
            )}
          </ScrollView>

          <View style={styles.modalFooter}>
            <Button
              title="取消"
              onPress={() => setShowAddModal(false)}
              variant="secondary"
              style={styles.modalButton}
            />
            <Button
              title="创建"
              onPress={handleAddProject}
              variant="primary"
              style={styles.modalButton}
            />
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderEditModal = () => (
    <Modal
      visible={showEditModal}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowEditModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>编辑项目</Text>
            <TouchableOpacity onPress={() => setShowEditModal(false)}>
              <MaterialIcons name="close" size={24} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>项目名称 *</Text>
              <TextInput
                style={[styles.formInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newProject.name}
                onChangeText={(text) => setNewProject({ ...newProject, name: text })}
                placeholder="例如：产品开发、市场推广"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>描述</Text>
              <TextInput
                style={[styles.formInput, styles.formTextArea, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newProject.description}
                onChangeText={(text) => setNewProject({ ...newProject, description: text })}
                placeholder="项目描述..."
                placeholderTextColor={theme.colors.textSecondary}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>状态</Text>
              <View style={styles.statusOptions}>
                {(['active', 'completed', 'paused'] as const).map((status) => (
                  <TouchableOpacity
                    key={status}
                    style={[
                      styles.statusOption,
                      newProject.status === status && { backgroundColor: theme.colors.primary },
                    ]}
                    onPress={() => setNewProject({ ...newProject, status })}
                  >
                    <Text
                      style={[
                        styles.statusOptionText,
                        { color: newProject.status === status ? '#FFFFFF' : theme.colors.text },
                      ]}
                    >
                      {status === 'active' ? '进行中' : status === 'completed' ? '已完成' : '已暂停'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {renderColorPicker(newProject.color || '#3b82f6', (color) =>
              setNewProject({ ...newProject, color })
            )}

            {renderIconPicker(newProject.icon || 'work', (icon) =>
              setNewProject({ ...newProject, icon })
            )}
          </ScrollView>

          <View style={styles.modalFooter}>
            <Button
              title="取消"
              onPress={() => setShowEditModal(false)}
              variant="secondary"
              style={styles.modalButton}
            />
            <Button
              title="保存"
              onPress={handleUpdateProject}
              variant="primary"
              style={styles.modalButton}
            />
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <MaterialIcons name="dashboard" size={64} color={theme.colors.textSecondary} style={{ opacity: 0.6 }} />
      <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>暂无项目</Text>
      <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>
        点击右上角的"新建"按钮，创建您的第一个项目
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {renderHeader()}
      {renderSearchBar()}

      <ScrollView
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
            {favoriteProjects.length > 0 && !showArchived && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                  收藏的项目 ({favoriteProjects.length})
                </Text>
                {viewMode === 'grid' ? (
                  <View style={styles.projectsGrid}>
                    {favoriteProjects.map(renderProjectCard)}
                  </View>
                ) : (
                  favoriteProjects.map(renderProjectListItem)
                )}
              </View>
            )}

            {activeProjects.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                  {showArchived ? '所有项目' : '项目'} ({activeProjects.length})
                </Text>
                {viewMode === 'grid' ? (
                  <View style={styles.projectsGrid}>
                    {activeProjects.map(renderProjectCard)}
                  </View>
                ) : (
                  activeProjects.map(renderProjectListItem)
                )}
              </View>
            )}

            {showArchived && archivedProjects.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                  已归档 ({archivedProjects.length})
                </Text>
                {viewMode === 'grid' ? (
                  <View style={styles.projectsGrid}>
                    {archivedProjects.map(renderProjectCard)}
                  </View>
                ) : (
                  archivedProjects.map(renderProjectListItem)
                )}
              </View>
            )}

            {projects.length === 0 && renderEmptyState()}
      </ScrollView>

      {renderAddModal()}
      {renderEditModal()}
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
  addButton: {
    padding: 4,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
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
    paddingVertical: 10,
  },
  clearIcon: {
    fontSize: 20,
    padding: 4,
  },
  viewModeButton: {
    padding: 8,
    marginRight: 4,
  },
  viewModeIcon: {
    fontSize: 20,
  },
  archiveButton: {
    padding: 8,
    borderRadius: 8,
  },
  archiveButtonText: {
    fontSize: 20,
  },
  contentContainer: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  projectsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  projectCard: {
    width: (width - 48) / 2,
    marginHorizontal: 6,
    marginBottom: 12,
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
  projectHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  projectIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  projectIconText: {
    fontSize: 20,
  },
  projectActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  favoriteIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  actionIcon: {
    fontSize: 20,
  },
  projectName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  projectDescription: {
    fontSize: 13,
    marginBottom: 12,
    lineHeight: 18,
  },
  projectStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
  },
  progressBarContainer: {
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 2,
    marginBottom: 12,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 2,
  },
  projectFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  projectDate: {
    fontSize: 11,
  },
  projectListItem: {
    flexDirection: 'row',
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  projectColorBar: {
    width: 6,
  },
  projectListContent: {
    flex: 1,
    padding: 12,
  },
  projectListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  projectListIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  projectListInfo: {
    flex: 1,
  },
  projectListName: {
    fontSize: 15,
    fontWeight: '600',
  },
  projectListDescription: {
    fontSize: 13,
    marginTop: 2,
  },
  projectListStats: {
    marginTop: 4,
  },
  projectListStatText: {
    fontSize: 12,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    marginTop: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    borderRadius: 12,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  modalClose: {
    fontSize: 28,
    lineHeight: 28,
  },
  modalBody: {
    padding: 16,
    maxHeight: 500,
  },
  formGroup: {
    marginBottom: 16,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  formInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  formTextArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  pickerSection: {
    marginBottom: 16,
  },
  pickerLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  colorOption: {
    width: 36,
    height: 36,
    borderRadius: 18,
    margin: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  colorOptionSelected: {
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  colorCheck: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  iconOption: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    margin: 2,
  },
  iconText: {
    fontSize: 24,
  },
  statusOptions: {
    flexDirection: 'row',
  },
  statusOption: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    marginHorizontal: 2,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  statusOptionText: {
    fontSize: 14,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  modalButton: {
    flex: 1,
    marginHorizontal: 4,
  },
  listContent: {
    flexGrow: 1,
  },
});
