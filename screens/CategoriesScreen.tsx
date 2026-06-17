import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  Platform,
  Alert,
  Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../src/shared/store';
import { RootStackParamList, Category } from '../src/shared/types';
import { Button } from '../src/shared/components/common';
import { toast } from '../src/shared/components/common/Toast';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Categories'>;

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#6b7280', '#1f2937', '#000000',
];

export default function CategoriesScreen() {
  const navigation = useNavigation<NavigationProp>();
  const {
    theme,
    categories,
    addCategory,
    updateCategory,
    deleteCategory,
    tasks,
  } = useAppStore();

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [newCategory, setNewCategory] = useState<Partial<Category>>({
    name: '',
    description: '',
    color: '#3b82f6',
    icon: 'folder',
  });
  const [searchQuery, setSearchQuery] = useState('');

  const getCategoryTaskCount = (categoryId: string): number => {
    return tasks.filter((task) => task.categoryId === categoryId && !task.isDeleted).length;
  };

  const handleAddCategory = () => {
    if (!newCategory.name?.trim()) {
      toast.error('请输入分类名称');
      return;
    }

    const category: Category = {
      id: `category-${Date.now()}`,
      name: newCategory.name.trim(),
      description: newCategory.description || '',
      color: newCategory.color || '#3b82f6',
      icon: newCategory.icon || 'folder',
      parentCategoryId: null,
      childCategoryIds: [],
      isSystem: false,
      isArchived: false,
      taskCount: 0,
      order: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      projectId: null,
    };

    addCategory(category);
    setShowAddModal(false);
    setNewCategory({
      name: '',
      description: '',
      color: '#3b82f6',
      icon: 'folder',
    });
    toast.success('分类已创建');
  };

  const handleUpdateCategory = () => {
    if (!selectedCategory || !newCategory.name?.trim()) return;

    updateCategory(selectedCategory.id, {
      name: newCategory.name.trim(),
      description: newCategory.description,
      color: newCategory.color,
      icon: newCategory.icon,
    });

    setShowEditModal(false);
    setSelectedCategory(null);
    toast.success('分类已更新');
  };

  const handleDeleteCategory = (categoryId: string) => {
    const taskCount = getCategoryTaskCount(categoryId);
    
    Alert.alert(
      '删除分类',
      taskCount > 0
        ? `此分类下有 ${taskCount} 个任务，删除后这些任务将被移至"无分类"。确定要删除吗？`
        : '确定要删除这个分类吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            deleteCategory(categoryId);
            toast.success('分类已删除');
          },
        },
      ]
    );
  };

  const openEditModal = (category: Category) => {
    setSelectedCategory(category);
    setNewCategory({
      name: category.name,
      description: category.description,
      color: category.color,
      icon: category.icon,
    });
    setShowEditModal(true);
  };

  const filteredCategories = categories.filter((category) =>
    category.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderHeader = () => (
    <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
        <MaterialIcons name="arrow-back" size={24} color={theme.colors.primary} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: theme.colors.text }]}>分类管理</Text>
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
          placeholder="搜索分类..."
          placeholderTextColor={theme.colors.textSecondary}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <MaterialIcons name="close" size={20} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderCategoryItem = ({ item }: { item: Category }) => {
    const taskCount = getCategoryTaskCount(item.id);

    return (
      <View style={[styles.categoryCard, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.categoryHeader}>
          <View style={styles.categoryIconContainer}>
            <MaterialIcons name={item.icon as any} size={32} color={item.color} />
            <View style={[styles.categoryColorDot, { backgroundColor: item.color }]} />
          </View>
          <View style={styles.categoryInfo}>
            <Text style={[styles.categoryName, { color: theme.colors.text }]}>{item.name}</Text>
            {item.description && (
              <Text style={[styles.categoryDescription, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                {item.description}
              </Text>
            )}
          </View>
          <View style={styles.categoryActions}>
            <TouchableOpacity onPress={() => openEditModal(item)} style={styles.actionButton}>
              <MaterialIcons name="edit" size={18} color={theme.colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDeleteCategory(item.id)} style={styles.actionButton}>
              <MaterialIcons name="delete" size={18} color={theme.colors.error} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.categoryFooter}>
          <View style={styles.statItem}>
            <MaterialIcons name="format-list-bulleted" size={14} color={theme.colors.textSecondary} style={{ marginRight: 4 }} />
            <Text style={[styles.statText, { color: theme.colors.textSecondary }]}>
              {taskCount} 个任务
            </Text>
          </View>
          <Text style={[styles.categoryDate, { color: theme.colors.textSecondary }]}>
            创建于 {new Date(item.createdAt).toLocaleDateString()}
          </Text>
        </View>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <MaterialIcons name="folder" size={64} color={theme.colors.textSecondary} style={{ opacity: 0.6 }} />
      <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>暂无分类</Text>
      <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>
        点击右上角的"新建"按钮，创建您的第一个分类
      </Text>
    </View>
  );

  const renderColorPicker = (
    selectedColor: string,
    onColorSelect: (color: string) => void
  ) => (
    <View style={styles.colorPicker}>
      <Text style={[styles.colorPickerLabel, { color: theme.colors.text }]}>选择颜色</Text>
      <View style={styles.colorGrid}>
        {PRESET_COLORS.map((color) => (
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

  const renderIconPicker = (
    selectedIcon: string,
    onIconSelect: (icon: string) => void
  ) => {
    const ICONS = [
      'folder', 'assignment', 'push-pin', 'attach-file', 'edit-note', 'auto-stories', 'library-books', 'book',
      'work', 'computer', 'phone-android', 'keyboard', 'desktop-windows', 'mouse', 'image', 'palette',
      'track-changes', 'casino', 'sports-esports', 'music-note', 'mic', 'movie', 'videocam', 'camera-alt',
      'home', 'business', 'school', 'local-hospital', 'account-balance', 'store', 'factory', 'rocket',
      'flight', 'directions-car', 'pedal-bike', 'access-alarm', 'timer', 'date-range', 'event', 'calendar-month',
      'star', 'stars', 'lightbulb', 'build', 'construction', 'settings', 'vpn-key', 'lock',
    ];

    return (
      <View style={styles.iconPicker}>
        <Text style={[styles.iconPickerLabel, { color: theme.colors.text }]}>选择图标</Text>
        <View style={styles.iconGrid}>
          {ICONS.map((icon) => (
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
  };

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
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>创建分类</Text>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <MaterialIcons name="close" size={24} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.modalBody}>
            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>分类名称 *</Text>
              <TextInput
                style={[styles.formInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newCategory.name}
                onChangeText={(text) => setNewCategory({ ...newCategory, name: text })}
                placeholder="例如：工作、学习"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>描述</Text>
              <TextInput
                style={[styles.formInput, styles.formTextArea, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newCategory.description}
                onChangeText={(text) => setNewCategory({ ...newCategory, description: text })}
                placeholder="分类描述..."
                placeholderTextColor={theme.colors.textSecondary}
                multiline
                numberOfLines={3}
              />
            </View>

            {renderColorPicker(newCategory.color || '#3b82f6', (color) =>
              setNewCategory({ ...newCategory, color })
            )}

            {renderIconPicker(newCategory.icon || 'folder', (icon) =>
              setNewCategory({ ...newCategory, icon })
            )}
          </View>

          <View style={styles.modalFooter}>
            <Button
              title="取消"
              onPress={() => setShowAddModal(false)}
              variant="secondary"
              style={styles.modalButton}
            />
            <Button
              title="创建"
              onPress={handleAddCategory}
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
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>编辑分类</Text>
            <TouchableOpacity onPress={() => setShowEditModal(false)}>
              <MaterialIcons name="close" size={24} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.modalBody}>
            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>分类名称 *</Text>
              <TextInput
                style={[styles.formInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newCategory.name}
                onChangeText={(text) => setNewCategory({ ...newCategory, name: text })}
                placeholder="例如：工作、学习"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>描述</Text>
              <TextInput
                style={[styles.formInput, styles.formTextArea, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newCategory.description}
                onChangeText={(text) => setNewCategory({ ...newCategory, description: text })}
                placeholder="分类描述..."
                placeholderTextColor={theme.colors.textSecondary}
                multiline
                numberOfLines={3}
              />
            </View>

            {renderColorPicker(newCategory.color || '#3b82f6', (color) =>
              setNewCategory({ ...newCategory, color })
            )}

            {renderIconPicker(newCategory.icon || 'folder', (icon) =>
              setNewCategory({ ...newCategory, icon })
            )}
          </View>

          <View style={styles.modalFooter}>
            <Button
              title="取消"
              onPress={() => setShowEditModal(false)}
              variant="secondary"
              style={styles.modalButton}
            />
            <Button
              title="保存"
              onPress={handleUpdateCategory}
              variant="primary"
              style={styles.modalButton}
            />
          </View>
        </View>
      </View>
    </Modal>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {renderHeader()}
      {renderSearchBar()}

      <FlatList
        data={filteredCategories}
        keyExtractor={(item) => item.id}
        renderItem={renderCategoryItem}
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

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
    padding: 16,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 12,
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
  listContent: {
    padding: 16,
    flexGrow: 1,
  },
  categoryCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
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
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  categoryIconContainer: {
    position: 'relative',
    marginRight: 12,
  },
  categoryIcon: {
    fontSize: 32,
  },
  categoryColorDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  categoryInfo: {
    flex: 1,
  },
  categoryName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  categoryDescription: {
    fontSize: 13,
  },
  categoryActions: {
    flexDirection: 'row',
  },
  actionButton: {
    padding: 8,
  },
  actionIcon: {
    fontSize: 18,
  },
  categoryFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
    paddingTop: 12,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statIcon: {
    fontSize: 14,
    marginRight: 4,
  },
  statText: {
    fontSize: 13,
  },
  categoryDate: {
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
  colorPicker: {
    marginBottom: 16,
  },
  colorPickerLabel: {
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
  iconPicker: {
    marginBottom: 16,
  },
  iconPickerLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
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
});
