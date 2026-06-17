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
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../src/shared/store';
import { RootStackParamList, Tag } from '../src/shared/types';
import { Button } from '../src/shared/components/common';
import { toast } from '../src/shared/components/common/Toast';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Tags'>;

const TAG_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#6b7280', '#1f2937', '#000000',
];

export default function TagsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { theme, tags, addTag, updateTag, deleteTag, mergeTags, tasks } = useAppStore();

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [selectedTag, setSelectedTag] = useState<Tag | null>(null);
  const [newTag, setNewTag] = useState<Partial<Tag>>({
    name: '',
    color: '#3b82f6',
    icon: '',
    isSystem: false,
  });
  const [mergeSourceTag, setMergeSourceTag] = useState<string | null>(null);
  const [mergeTargetTag, setMergeTargetTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const getTagUsageCount = (tagId: string): number => {
    return tasks.filter((task) => task.tags.includes(tagId) && !task.isDeleted).length;
  };

  const filteredTags = tags.filter((tag) =>
    tag.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedTags = [...filteredTags].sort((a, b) => b.usageCount - a.usageCount);

  const handleAddTag = () => {
    if (!newTag.name?.trim()) {
      toast.error('请输入标签名称');
      return;
    }

    const tag: Tag = {
      id: `tag-${Date.now()}`,
      name: newTag.name.trim(),
      color: newTag.color || '#3b82f6',
      icon: newTag.icon || '',
      isSystem: false,
      usageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
    };

    addTag(tag);
    setShowAddModal(false);
    setNewTag({
      name: '',
      color: '#3b82f6',
      icon: '',
      isSystem: false,
    });
    toast.success('标签已创建');
  };

  const handleUpdateTag = () => {
    if (!selectedTag || !newTag.name?.trim()) return;

    updateTag(selectedTag.id, {
      name: newTag.name.trim(),
      color: newTag.color,
      icon: newTag.icon,
    });

    setShowEditModal(false);
    setSelectedTag(null);
    toast.success('标签已更新');
  };

  const handleDeleteTag = (tagId: string) => {
    const usageCount = getTagUsageCount(tagId);
    
    Alert.alert(
      '删除标签',
      usageCount > 0
        ? `此标签被 ${usageCount} 个任务使用，删除后将从这些任务中移除。确定要删除吗？`
        : '确定要删除这个标签吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => deleteTag(tagId),
        },
      ]
    );
  };

  const handleMergeTags = () => {
    if (!mergeSourceTag || !mergeTargetTag) {
      toast.error('请选择要合并的标签');
      return;
    }

    if (mergeSourceTag === mergeTargetTag) {
      toast.error('不能将标签合并到自身');
      return;
    }

    Alert.alert(
      '合并标签',
      '合并后，源标签将被删除，其使用记录将转移到目标标签。确定要合并吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '合并',
          onPress: () => {
            mergeTags(mergeSourceTag, mergeTargetTag);
            setShowMergeModal(false);
            setMergeSourceTag(null);
            setMergeTargetTag(null);
            toast.success('标签已合并');
          },
        },
      ]
    );
  };

  const openEditModal = (tag: Tag) => {
    setSelectedTag(tag);
    setNewTag({
      name: tag.name,
      color: tag.color,
      icon: tag.icon,
    });
    setShowEditModal(true);
  };

  const openMergeModal = () => {
    if (tags.length < 2) {
      toast.info('需要至少2个标签才能合并');
      return;
    }
    setShowMergeModal(true);
  };

  const renderTagItem = ({ item }: { item: Tag }) => {
    const usageCount = getTagUsageCount(item.id);

    return (
      <View style={[styles.tagCard, { backgroundColor: theme.colors.surface }]}>
        <TouchableOpacity
          style={styles.tagContent}
          onPress={() => openEditModal(item)}
          onLongPress={() => {
            Alert.alert(item.name, '选择操作', [
              { text: '编辑', onPress: () => openEditModal(item) },
              { text: '删除', style: 'destructive', onPress: () => handleDeleteTag(item.id) },
              { text: '取消', style: 'cancel' },
            ]);
          }}
        >
          <View style={[styles.tagColorBar, { backgroundColor: item.color }]} />
          <View style={styles.tagInfo}>
            <View style={styles.tagHeader}>
              {item.icon && <Text style={styles.tagIcon}>{item.icon}</Text>}
              <Text style={[styles.tagName, { color: theme.colors.text }]}>{item.name}</Text>
              {item.isSystem && (
                <View style={[styles.systemBadge, { backgroundColor: theme.colors.primary + '20' }]}>
                  <Text style={[styles.systemBadgeText, { color: theme.colors.primary }]}>系统</Text>
                </View>
              )}
            </View>
            <View style={styles.tagMeta}>
              <Text style={[styles.usageCount, { color: theme.colors.textSecondary }]}>
                {usageCount} 个任务使用
              </Text>
              <Text style={[styles.tagDate, { color: theme.colors.textSecondary }]}>
                创建于 {new Date(item.createdAt).toLocaleDateString()}
              </Text>
            </View>
          </View>
          <MaterialIcons name="chevron-right" size={24} color={theme.colors.textSecondary} />
        </TouchableOpacity>
      </View>
    );
  };

  const renderHeader = () => (
    <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
        <MaterialIcons name="arrow-back" size={24} color={theme.colors.primary} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: theme.colors.text }]}>标签管理</Text>
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
          placeholder="搜索标签..."
          placeholderTextColor={theme.colors.textSecondary}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <MaterialIcons name="close" size={20} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity
        style={[styles.mergeButton, { backgroundColor: theme.colors.primary }]}
        onPress={openMergeModal}
      >
        <Text style={styles.mergeButtonText}>合并</Text>
      </TouchableOpacity>
    </View>
  );

  const renderColorPicker = () => (
    <View style={styles.pickerSection}>
      <Text style={[styles.pickerLabel, { color: theme.colors.text }]}>选择颜色</Text>
      <View style={styles.colorGrid}>
        {TAG_COLORS.map((color) => (
          <TouchableOpacity
            key={color}
            style={[
              styles.colorOption,
              { backgroundColor: color },
              (newTag.color || '#3b82f6') === color && styles.colorOptionSelected,
            ]}
            onPress={() => setNewTag({ ...newTag, color })}
          >
            {(newTag.color || '#3b82f6') === color && <MaterialIcons name="check" size={18} color="#FFFFFF" />}
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
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>创建标签</Text>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <MaterialIcons name="close" size={24} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>标签名称 *</Text>
              <TextInput
                style={[styles.formInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newTag.name}
                onChangeText={(text) => setNewTag({ ...newTag, name: text })}
                placeholder="例如：工作、重要、紧急"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>图标（可选）</Text>
              <TextInput
                style={[styles.formInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newTag.icon}
                onChangeText={(text) => setNewTag({ ...newTag, icon: text })}
                placeholder="例如：红色"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>

            {renderColorPicker()}

            <View style={[styles.previewSection, { backgroundColor: newTag.color + '20' }]}>
              <Text style={[styles.previewLabel, { color: theme.colors.textSecondary }]}>预览</Text>
              <View style={[styles.previewTag, { backgroundColor: newTag.color || '#3b82f6' }]}>
                {newTag.icon && <Text style={styles.previewIcon}>{newTag.icon}</Text>}
                <Text style={styles.previewText}>{newTag.name || '标签名称'}</Text>
              </View>
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
              onPress={handleAddTag}
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
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>编辑标签</Text>
            <TouchableOpacity onPress={() => setShowEditModal(false)}>
              <MaterialIcons name="close" size={24} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>标签名称 *</Text>
              <TextInput
                style={[styles.formInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newTag.name}
                onChangeText={(text) => setNewTag({ ...newTag, name: text })}
                placeholder="例如：工作、重要、紧急"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>图标（可选）</Text>
              <TextInput
                style={[styles.formInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newTag.icon}
                onChangeText={(text) => setNewTag({ ...newTag, icon: text })}
                placeholder="例如：红色"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>

            {renderColorPicker()}

            <View style={[styles.previewSection, { backgroundColor: newTag.color + '20' }]}>
              <Text style={[styles.previewLabel, { color: theme.colors.textSecondary }]}>预览</Text>
              <View style={[styles.previewTag, { backgroundColor: newTag.color || '#3b82f6' }]}>
                {newTag.icon && <Text style={styles.previewIcon}>{newTag.icon}</Text>}
                <Text style={styles.previewText}>{newTag.name || '标签名称'}</Text>
              </View>
            </View>

            {!selectedTag?.isSystem && (
              <TouchableOpacity
                style={[styles.deleteButton, { backgroundColor: theme.colors.error + '10' }]}
                onPress={() => {
                  if (selectedTag) {
                    handleDeleteTag(selectedTag.id);
                    setShowEditModal(false);
                  }
                }}
              >
                <Text style={[styles.deleteButtonText, { color: theme.colors.error }]}>
                  删除标签
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
              onPress={handleUpdateTag}
              variant="primary"
              style={styles.modalButton}
            />
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderMergeModal = () => (
    <Modal
      visible={showMergeModal}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowMergeModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>合并标签</Text>
            <TouchableOpacity onPress={() => setShowMergeModal(false)}>
              <MaterialIcons name="close" size={24} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <Text style={[styles.mergeDescription, { color: theme.colors.textSecondary }]}>
              选择要合并的两个标签。合并后，源标签的所有使用记录将转移到目标标签，源标签将被删除。
            </Text>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>源标签（将被删除）</Text>
              <View style={styles.tagSelector}>
                {tags.map((tag) => (
                  <TouchableOpacity
                    key={tag.id}
                    style={[
                      styles.tagOption,
                      { backgroundColor: tag.color + '20', borderColor: tag.color },
                      mergeSourceTag === tag.id && { backgroundColor: tag.color },
                    ]}
                    onPress={() => setMergeSourceTag(tag.id)}
                    disabled={mergeTargetTag === tag.id}
                  >
                    <Text
                      style={[
                        styles.tagOptionText,
                        { color: mergeSourceTag === tag.id ? '#FFFFFF' : tag.color },
                      ]}
                    >
                      {tag.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>目标标签（保留）</Text>
              <View style={styles.tagSelector}>
                {tags
                  .filter((tag) => tag.id !== mergeSourceTag)
                  .map((tag) => (
                    <TouchableOpacity
                      key={tag.id}
                      style={[
                        styles.tagOption,
                        { backgroundColor: tag.color + '20', borderColor: tag.color },
                        mergeTargetTag === tag.id && { backgroundColor: tag.color },
                      ]}
                      onPress={() => setMergeTargetTag(tag.id)}
                    >
                      <Text
                        style={[
                          styles.tagOptionText,
                          { color: mergeTargetTag === tag.id ? '#FFFFFF' : tag.color },
                        ]}
                      >
                        {tag.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
              </View>
            </View>
          </ScrollView>

          <View style={styles.modalFooter}>
            <Button
              title="取消"
              onPress={() => setShowMergeModal(false)}
              variant="secondary"
              style={styles.modalButton}
            />
            <Button
              title="合并"
              onPress={handleMergeTags}
              variant="primary"
              style={styles.modalButton}
              disabled={!mergeSourceTag || !mergeTargetTag}
            />
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <MaterialIcons name="local-offer" size={64} color={theme.colors.textSecondary} style={{ opacity: 0.6 }} />
      <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>暂无标签</Text>
      <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>
        点击右上角的"新建"按钮，创建您的第一个标签
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {renderHeader()}
      {renderSearchBar()}

      <FlatList
        data={sortedTags}
        keyExtractor={(item) => item.id}
        renderItem={renderTagItem}
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {renderAddModal()}
      {renderEditModal()}
      {renderMergeModal()}
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
  mergeButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  mergeButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    flexGrow: 1,
  },
  tagCard: {
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
  tagContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  tagColorBar: {
    width: 4,
    height: 40,
    borderRadius: 2,
    marginRight: 12,
  },
  tagInfo: {
    flex: 1,
  },
  tagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  tagIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  tagName: {
    fontSize: 16,
    fontWeight: '600',
  },
  systemBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8,
  },
  systemBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  tagMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  usageCount: {
    fontSize: 12,
  },
  tagDate: {
    fontSize: 11,
  },
  arrowIcon: {
    fontSize: 20,
    marginLeft: 8,
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
  previewSection: {
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    alignItems: 'center',
  },
  previewLabel: {
    fontSize: 12,
    marginBottom: 8,
  },
  previewTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  previewIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  previewText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  deleteButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  deleteButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  mergeDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  tagSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tagOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 2,
    marginRight: 8,
    marginBottom: 8,
  },
  tagOptionText: {
    fontSize: 13,
    fontWeight: '500',
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
