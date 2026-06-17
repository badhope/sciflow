import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppStore } from '../src/shared/store';
import { RootStackParamList, Template } from '../src/shared/types';
import { Button } from '../src/shared/components/common';
import { toast } from '../src/shared/components/common/Toast';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Templates'>;

const TEMPLATE_TYPES = [
  { type: 'task', label: '任务模板', iconName: 'check-circle' as keyof typeof MaterialIcons.glyphMap },
  { type: 'project', label: '项目模板', iconName: 'bar-chart' as keyof typeof MaterialIcons.glyphMap },
  { type: 'note', label: '笔记模板', iconName: 'edit-note' as keyof typeof MaterialIcons.glyphMap },
  { type: 'habit', label: '习惯模板', iconName: 'repeat' as keyof typeof MaterialIcons.glyphMap },
  { type: 'workflow', label: '工作流模板', iconName: 'loop' as keyof typeof MaterialIcons.glyphMap },
];

export default function TemplatesScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { theme, templates, addTemplate, deleteTemplate, applyTemplate } = useAppStore();

  const [showAddModal, setShowAddModal] = useState(false);
  const [newTemplate, setNewTemplate] = useState<Partial<Template>>({
    name: '',
    description: '',
    type: 'task',
    isPublic: false,
    isSystem: false,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [, setSelectedTemplate] = useState<Template | null>(null);
  const [, setShowEditModal] = useState(false);

  const filteredTemplates = templates.filter((template) => {
    if (selectedType && template.type !== selectedType) return false;
    if (searchQuery && !template.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const handleAddTemplate = () => {
    if (!newTemplate.name?.trim()) {
      toast.error('请输入模板名称');
      return;
    }

    const template: Template = {
      id: `template-${Date.now()}`,
      name: newTemplate.name.trim(),
      description: newTemplate.description || '',
      type: newTemplate.type as any || 'task',
      thumbnail: '',
      isPublic: false,
      isSystem: false,
      usageCount: 0,
      downloads: 0,
      rating: 0,
      tags: [],
      content: {},
      variables: [],
      author: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
    };

    addTemplate(template);
    setShowAddModal(false);
    setNewTemplate({
      name: '',
      description: '',
      type: 'task',
      isPublic: false,
      isSystem: false,
    });
    toast.success('模板已创建');
  };

  const handleDeleteTemplate = (templateId: string) => {
    Alert.alert(
      '删除模板',
      '确定要删除这个模板吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => deleteTemplate(templateId),
        },
      ]
    );
  };

  const handleApplyTemplate = (template: Template) => {
    Alert.alert(
      '应用模板',
      `确定要应用"${template.name}"模板吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '应用',
          onPress: () => {
            applyTemplate(template.id);
            toast.success('模板已应用');
          },
        },
      ]
    );
  };

  const openEditModal = (template: Template) => {
    setSelectedTemplate(template);
    setNewTemplate({
      name: template.name,
      description: template.description,
      type: template.type,
    });
    setShowEditModal(true);
  };

  const renderTemplateCard = ({ item }: { item: Template }) => {
    const typeInfo = TEMPLATE_TYPES.find((t) => t.type === item.type);

    return (
      <View style={[styles.templateCard, { backgroundColor: theme.colors.surface }]}>
        <TouchableOpacity
          style={styles.templateContent}
          onPress={() => handleApplyTemplate(item)}
          onLongPress={() => {
            Alert.alert(item.name, '选择操作', [
              { text: '应用模板', onPress: () => handleApplyTemplate(item) },
              ...(!item.isSystem ? [
                { text: '编辑', onPress: () => openEditModal(item) },
                { text: '删除', style: 'destructive' as const, onPress: () => handleDeleteTemplate(item.id) },
              ] : []),
              { text: '取消', style: 'cancel' as const },
            ]);
          }}
        >
          <View style={styles.templateHeader}>
            <Text style={styles.templateIcon}>
            <MaterialIcons name={typeInfo?.iconName || 'format-list-bulleted'} size={32} color={theme.colors.primary} />
          </Text>
            {item.isSystem && (
              <View style={[styles.systemBadge, { backgroundColor: theme.colors.primary + '20' }]}>
                <Text style={[styles.systemBadgeText, { color: theme.colors.primary }]}>系统</Text>
              </View>
            )}
            {item.isPublic && (
              <View style={[styles.publicBadge, { backgroundColor: '#10b98120' }]}>
                <Text style={[styles.publicBadgeText, { color: '#10b981' }]}>公开</Text>
              </View>
            )}
          </View>

          <Text style={[styles.templateName, { color: theme.colors.text }]} numberOfLines={2}>
            {item.name}
          </Text>

          {item.description && (
            <Text style={[styles.templateDescription, { color: theme.colors.textSecondary }]} numberOfLines={2}>
              {item.description}
            </Text>
          )}

          <View style={styles.templateMeta}>
            <Text style={[styles.templateType, { color: theme.colors.textSecondary }]}>
              {typeInfo?.label || item.type}
            </Text>
            <Text style={[styles.templateUsage, { color: theme.colors.textSecondary }]}>
              使用 {item.usageCount} 次
            </Text>
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
      <Text style={[styles.headerTitle, { color: theme.colors.text }]}>模板管理</Text>
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
          placeholder="搜索模板..."
          placeholderTextColor={theme.colors.textSecondary}
        />
      </View>
    </View>
  );

  const renderTypeFilter = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeFilter}>
      <TouchableOpacity
        style={[
          styles.typeButton,
          !selectedType && { backgroundColor: theme.colors.primary },
        ]}
        onPress={() => setSelectedType(null)}
      >
        <Text style={[styles.typeButtonText, { color: !selectedType ? '#FFFFFF' : theme.colors.text }]}>
          全部
        </Text>
      </TouchableOpacity>
      {TEMPLATE_TYPES.map((type) => (
        <TouchableOpacity
          key={type.type}
          style={[
            styles.typeButton,
            selectedType === type.type && { backgroundColor: theme.colors.primary },
          ]}
          onPress={() => setSelectedType(type.type)}
        >
          <MaterialIcons name={type.iconName} size={16} color={selectedType === type.type ? '#FFFFFF' : theme.colors.primary} style={{ marginRight: 4 }} />
          <Text style={[styles.typeButtonText, { color: selectedType === type.type ? '#FFFFFF' : theme.colors.text }]}>
            {type.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const renderAddModal = () => (
    <Modal visible={showAddModal} animationType="slide" transparent={true} onRequestClose={() => setShowAddModal(false)}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>创建模板</Text>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <MaterialIcons name="close" size={24} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>模板名称 *</Text>
              <TextInput
                style={[styles.formInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newTemplate.name}
                onChangeText={(text) => setNewTemplate({ ...newTemplate, name: text })}
                placeholder="例如：每周工作总结"
                placeholderTextColor={theme.colors.textSecondary}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>描述</Text>
              <TextInput
                style={[styles.formInput, styles.formTextArea, { color: theme.colors.text, borderColor: theme.colors.border }]}
                value={newTemplate.description}
                onChangeText={(text) => setNewTemplate({ ...newTemplate, description: text })}
                placeholder="模板描述..."
                placeholderTextColor={theme.colors.textSecondary}
                multiline
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: theme.colors.text }]}>模板类型</Text>
              <View style={styles.typeOptions}>
                {TEMPLATE_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type.type}
                    style={[
                      styles.typeOption,
                      newTemplate.type === type.type && { backgroundColor: theme.colors.primary + '20' },
                    ]}
                    onPress={() => setNewTemplate({ ...newTemplate, type: type.type as any })}
                  >
                    <MaterialIcons name={type.iconName} size={16} color={theme.colors.primary} style={{ marginRight: 4 }} />
                    <Text style={[styles.typeOptionText, { color: theme.colors.text }]}>{type.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>

          <View style={styles.modalFooter}>
            <Button title="取消" onPress={() => setShowAddModal(false)} variant="secondary" style={styles.modalButton} />
            <Button title="创建" onPress={handleAddTemplate} variant="primary" style={styles.modalButton} />
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <MaterialIcons name="description" size={64} color={theme.colors.textSecondary} style={{ opacity: 0.6 }} />
      <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>暂无模板</Text>
      <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>
        点击右上角的"新建"按钮，创建您的第一个模板
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {renderHeader()}
      {renderSearchBar()}
      {renderTypeFilter()}

      <FlatList
        data={filteredTemplates}
        keyExtractor={(item) => item.id}
        renderItem={renderTemplateCard}
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {renderAddModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  backButton: { padding: 4 },
  backButtonText: { fontSize: 16 },
  headerTitle: { fontSize: 18, fontWeight: '600' },
  addButton: { padding: 4 },
  addButtonText: { fontSize: 16, fontWeight: '600' },
  searchBar: { padding: 16 },
  searchInputContainer: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingHorizontal: 12 },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 10 },
  typeFilter: { paddingHorizontal: 16, marginBottom: 12 },
  typeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
  },
  typeButtonIcon: { fontSize: 16, marginRight: 4 },
  typeButtonText: { fontSize: 13, fontWeight: '500' },
  listContent: { padding: 16, flexGrow: 1 },
  templateCard: { marginBottom: 12, borderRadius: 12, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  templateContent: { padding: 16 },
  templateHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  templateIcon: { fontSize: 32, marginRight: 8 },
  systemBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginRight: 4 },
  systemBadgeText: { fontSize: 10, fontWeight: '600' },
  publicBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  publicBadgeText: { fontSize: 10, fontWeight: '600' },
  templateName: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  templateDescription: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  templateMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  templateType: { fontSize: 12 },
  templateUsage: { fontSize: 12 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, marginTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { borderRadius: 12, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.1)' },
  modalTitle: { fontSize: 18, fontWeight: '600' },
  modalClose: { fontSize: 28, lineHeight: 28 },
  modalBody: { padding: 16, maxHeight: 500 },
  formGroup: { marginBottom: 16 },
  formLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  formInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  formTextArea: { minHeight: 80, textAlignVertical: 'top' },
  typeOptions: { flexDirection: 'row', flexWrap: 'wrap' },
  typeOption: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginRight: 8, marginBottom: 8 },
  typeOptionIcon: { fontSize: 16, marginRight: 4 },
  typeOptionText: { fontSize: 13 },
  modalFooter: { flexDirection: 'row', padding: 16, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.1)' },
  modalButton: { flex: 1, marginHorizontal: 4 },
});
