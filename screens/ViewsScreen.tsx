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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../src/shared/store';
import { RootStackParamList, View as CustomView, ViewType } from '../src/shared/types';
import { Button } from '../src/shared/components/common';
import { toast } from '../src/shared/components/common/Toast';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Views'>;

const VIEW_TYPES: { type: ViewType; label: string; iconName: keyof typeof MaterialIcons.glyphMap; description: string }[] = [
  { type: 'list', label: '列表视图', iconName: 'format-list-bulleted', description: '经典的任务列表展示' },
  { type: 'kanban', label: '看板视图', iconName: 'dashboard', description: '拖拽式任务看板' },
  { type: 'calendar', label: '日历视图', iconName: 'calendar-today', description: '日历形式查看任务' },
  { type: 'timeline', label: '时间线视图', iconName: 'timeline', description: '时间轴上的任务展示' },
  { type: 'table', label: '表格视图', iconName: 'table-chart', description: '表格形式的任务列表' },
  { type: 'gantt', label: '甘特图视图', iconName: 'trending-up', description: '项目进度甘特图' },
  { type: 'mindmap', label: '思维导图', iconName: 'share', description: '思维导图形式展示' },
  { type: 'time-block', label: '时间块视图', iconName: 'schedule', description: '时间块规划视图' },
];

export default function ViewsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { theme, views, addView, updateView, deleteView, setActiveView, activeView } = useAppStore();

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedView, setSelectedView] = useState<CustomView | null>(null);
  const [newView, setNewView] = useState<Partial<CustomView>>({
    name: '',
    type: 'list',
    isSystem: false,
    isFavorite: false,
  });

  const handleAddView = () => {
    if (!newView.name?.trim()) {
      toast.error('请输入视图名称');
      return;
    }

    const view: CustomView = {
      id: `view-${Date.now()}`,
      name: newView.name.trim(),
      type: newView.type || 'list',
      isSystem: false,
      isFavorite: false,
      projectId: null,
      filters: [],
      sortOptions: [],
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
      colorSchema: theme.colors.primary,
      icon: 'format-list-bulleted',
      iconName: VIEW_TYPES.find((v) => v.type === newView.type)?.iconName || 'format-list-bulleted',
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
    };

    addView(view);
    setShowAddModal(false);
    setNewView({
      name: '',
      type: 'list',
      isSystem: false,
      isFavorite: false,
    });
    toast.success('视图已创建');
  };

  const handleUpdateView = () => {
    if (!selectedView || !newView.name?.trim()) return;

    updateView(selectedView.id, {
      name: newView.name.trim(),
      type: newView.type,
      isFavorite: newView.isFavorite,
      layout: newView.layout,
    });

    setShowEditModal(false);
    setSelectedView(null);
    toast.success('视图已更新');
  };

  const handleDeleteView = (viewId: string) => {
    const view = views.find((v) => v.id === viewId);
    if (view?.isSystem) {
      toast.info('系统视图不能删除');
      return;
    }

    Alert.alert(
      '删除视图',
      '确定要删除这个视图吗？',
      [
        { text: '取消', style: 'cancel' as const },
        {
          text: '删除',
          style: 'destructive' as const,
          onPress: () => deleteView(viewId),
        },
      ]
    );
  };

  const handleSetActive = (viewId: string) => {
    const view = views.find((v) => v.id === viewId);
    if (view) {
      setActiveView(view);
      toast.success('已切换到该视图');
    }
  };

  const handleToggleFavorite = (viewId: string) => {
    const view = views.find((v) => v.id === viewId);
    if (view) {
      updateView(viewId, { isFavorite: !view.isFavorite });
    }
  };

  const openEditModal = (view: CustomView) => {
    setSelectedView(view);
    setNewView({
      name: view.name,
      type: view.type,
      isFavorite: view.isFavorite,
      layout: view.layout,
    });
    setShowEditModal(true);
  };

  const renderViewCard = ({ item }: { item: CustomView }) => {
    const viewTypeInfo = VIEW_TYPES.find((v) => v.type === item.type);
    const isActive = activeView?.id === item.id;

    return (
      <View style={[styles.viewCard, { backgroundColor: theme.colors.surface }]}>
        <TouchableOpacity
          style={styles.viewContent}
          onPress={() => handleSetActive(item.id)}
          onLongPress={() => {
            Alert.alert(item.name, '选择操作', [
              { text: '使用此视图', onPress: () => handleSetActive(item.id) },
              ...(!item.isSystem ? [
                { text: '编辑', onPress: () => openEditModal(item) },
                { text: item.isFavorite ? '取消收藏' : '收藏', onPress: () => handleToggleFavorite(item.id) },
                { text: '删除', style: 'destructive' as const, onPress: () => handleDeleteView(item.id) },
              ] : []),
              { text: '取消', style: 'cancel' as const },
            ]);
          }}
        >
          <View style={styles.viewHeader}>
            <View style={[styles.viewIcon, { backgroundColor: item.colorSchema + '20' }]}>
              <MaterialIcons name={item.iconName as any || 'format-list-bulleted' as any} size={20} color={item.colorSchema} />
            </View>
            {isActive && (
              <View style={[styles.activeBadge, { backgroundColor: '#10b98120' }]}>
                <Text style={styles.activeBadgeText}>使用中</Text>
              </View>
            )}
            {item.isFavorite && <MaterialIcons name="star" size={18} color="#F59E0B" style={styles.favoriteIcon} />}
            {item.isSystem && (
              <View style={[styles.systemBadge, { backgroundColor: theme.colors.primary + '20' }]}>
                <Text style={styles.systemBadgeText}>系统</Text>
              </View>
            )}
          </View>

          <Text style={[styles.viewName, { color: theme.colors.text }]}>{item.name}</Text>
          
          <View style={styles.viewMeta}>
            <Text style={[styles.viewType, { color: theme.colors.textSecondary }]}>
              {viewTypeInfo?.label || item.type}
            </Text>
          </View>

          <View style={styles.viewStats}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.colors.primary }]}>
                {item.filters?.length || 0}
              </Text>
              <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>筛选</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.colors.text }]}>
                {item.sortOptions?.length || 0}
              </Text>
              <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>排序</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.colors.text }]}>
                {item.groupBy ? <MaterialIcons name="check" size={14} color="#10b981" /> : <MaterialIcons name="close" size={14} color={theme.colors.textSecondary} />}
              </Text>
              <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>分组</Text>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  const renderHeader = () => (
    <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
        <MaterialIcons name="arrow-back" size={24} color={theme.colors.primary} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: theme.colors.text }]}>视图管理</Text>
      <TouchableOpacity onPress={() => setShowAddModal(true)} style={styles.addButton}>
        <Text style={[styles.addButtonText, { color: theme.colors.primary }]}>+ 新建</Text>
      </TouchableOpacity>
    </View>
  );

  const renderViewTypeSelector = () => (
    <View style={styles.typeSelector}>
      <Text style={[styles.typeSelectorLabel, { color: theme.colors.text }]}>选择视图类型</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {VIEW_TYPES.map((viewType) => (
          <TouchableOpacity
            key={viewType.type}
            style={[
              styles.typeOption,
              { backgroundColor: theme.colors.background },
              newView.type === viewType.type && { backgroundColor: theme.colors.primary + '20' },
            ]}
            onPress={() => setNewView({ ...newView, type: viewType.type })}
          >
            <MaterialIcons name={viewType.iconName} size={24} color={theme.colors.primary} />
            <Text style={[styles.typeLabel, { color: theme.colors.text }]}>
              {viewType.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
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
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>创建视图</Text>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <MaterialIcons name="close" size={24} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>视图名称 *</Text>
              <TextInput
                style={[styles.formInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newView.name}
                onChangeText={(text) => setNewView({ ...newView, name: text })}
                placeholder="例如：我的工作视图"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>

            {renderViewTypeSelector()}

            <View style={[styles.previewSection, { backgroundColor: theme.colors.background }]}>
              <Text style={[styles.previewLabel, { color: theme.colors.textSecondary }]}>预览</Text>
              <View style={styles.previewContent}>
                <MaterialIcons
                  name={VIEW_TYPES.find((v) => v.type === newView.type)?.iconName || 'format-list-bulleted'}
                  size={24}
                  color={theme.colors.primary}
                />
                <Text style={[styles.previewName, { color: theme.colors.text }]}>
                  {newView.name || '视图名称'}
                </Text>
              </View>
              <Text style={[styles.previewDescription, { color: theme.colors.textSecondary }]}>
                {VIEW_TYPES.find((v) => v.type === newView.type)?.description}
              </Text>
            </View>
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
              onPress={handleAddView}
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
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>编辑视图</Text>
            <TouchableOpacity onPress={() => setShowEditModal(false)}>
              <MaterialIcons name="close" size={24} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>视图名称 *</Text>
              <TextInput
                style={[styles.formInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newView.name}
                onChangeText={(text) => setNewView({ ...newView, name: text })}
                placeholder="例如：我的工作视图"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>

            {!selectedView?.isSystem && (
              <View style={styles.formGroup}>
                <Text style={[styles.formLabel, { color: theme.colors.text }]}>视图类型</Text>
                <View style={styles.typeDisplay}>
                  <MaterialIcons
                    name={VIEW_TYPES.find((v) => v.type === newView.type)?.iconName || 'format-list-bulleted'}
                    size={20}
                    color={theme.colors.primary}
                    style={{ marginRight: 8 }}
                  />
                  <Text style={[styles.typeDisplayText, { color: theme.colors.text }]}>
                    {VIEW_TYPES.find((v) => v.type === newView.type)?.label || newView.type}
                  </Text>
                </View>
              </View>
            )}

            <View style={[styles.statsSection, { backgroundColor: theme.colors.background }]}>
              <Text style={[styles.statsSectionTitle, { color: theme.colors.textSecondary }]}>
                视图统计
              </Text>
              <View style={styles.statsGrid}>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: theme.colors.primary }]}>
                    {selectedView?.filters?.length || 0}
                  </Text>
                  <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>筛选条件</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: theme.colors.primary }]}>
                    {selectedView?.sortOptions?.length || 0}
                  </Text>
                  <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>排序方式</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: theme.colors.primary }]}>
                    {selectedView?.groupBy ? '已设置' : '未设置'}
                  </Text>
                  <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>分组方式</Text>
                </View>
              </View>
            </View>

            {!selectedView?.isSystem && (
              <TouchableOpacity
                style={[styles.deleteButton, { backgroundColor: theme.colors.error + '10' }]}
                onPress={() => {
                  if (selectedView) {
                    handleDeleteView(selectedView.id);
                    setShowEditModal(false);
                  }
                }}
              >
                <Text style={[styles.deleteButtonText, { color: theme.colors.error }]}>
                  删除视图
                </Text>
              </TouchableOpacity>
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
              onPress={handleUpdateView}
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
      <MaterialIcons name="view-list" size={64} color={theme.colors.textSecondary} style={{ opacity: 0.6 }} />
      <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>暂无自定义视图</Text>
      <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>
        点击右上角的"新建"按钮，创建您的第一个自定义视图
      </Text>
    </View>
  );

  const systemViews = views.filter((v) => v.isSystem);
  const customViews = views.filter((v) => !v.isSystem);
  const favoriteViews = views.filter((v) => v.isFavorite);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {renderHeader()}

      <ScrollView
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
            {favoriteViews.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                  收藏的视图 ({favoriteViews.length})
                </Text>
                <View style={styles.viewsGrid}>
                  {favoriteViews.map((view) => renderViewCard({ item: view }))}
                </View>
              </View>
            )}

            {systemViews.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                  系统视图 ({systemViews.length})
                </Text>
                <View style={styles.viewsGrid}>
                  {systemViews.map((view) => renderViewCard({ item: view }))}
                </View>
              </View>
            )}

            {customViews.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                  自定义视图 ({customViews.length})
                </Text>
                <View style={styles.viewsGrid}>
                  {customViews.map((view) => renderViewCard({ item: view }))}
                </View>
              </View>
            )}

            {views.length === 0 && renderEmptyState()}
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
  viewsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  viewCard: {
    width: '47%',
    marginHorizontal: '1.5%',
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
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
  viewContent: {
    padding: 16,
  },
  viewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  viewIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  viewIconText: {
    fontSize: 20,
  },
  activeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginRight: 4,
  },
  activeBadgeText: {
    color: '#10b981',
    fontSize: 10,
    fontWeight: '600',
  },
  systemBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  systemBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  favoriteIcon: {
    fontSize: 14,
  },
  viewName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  viewMeta: {
    marginBottom: 12,
  },
  viewType: {
    fontSize: 12,
  },
  viewStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 10,
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
  typeSelector: {
    marginBottom: 16,
  },
  typeSelectorLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  typeOption: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginRight: 8,
    minWidth: 80,
  },
  typeIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  typeLabel: {
    fontSize: 12,
    textAlign: 'center',
  },
  previewSection: {
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  previewLabel: {
    fontSize: 12,
    marginBottom: 8,
  },
  previewContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  previewIcon: {
    fontSize: 24,
    marginRight: 8,
  },
  previewName: {
    fontSize: 16,
    fontWeight: '600',
  },
  previewDescription: {
    fontSize: 13,
  },
  statsSection: {
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  statsSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  typeDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  typeDisplayIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  typeDisplayText: {
    fontSize: 14,
  },
  deleteButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  deleteButtonText: {
    fontSize: 15,
    fontWeight: '600',
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
