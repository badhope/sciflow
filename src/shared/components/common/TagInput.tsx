import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Modal,
} from 'react-native';
import { useAppStore } from '../../store';

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  label?: string;
  placeholder?: string;
}

export const TagInput: React.FC<TagInputProps> = ({
  value,
  onChange,
  label,
  placeholder: _placeholder = '添加标签...',
}) => {
  const { theme, tags } = useAppStore();
  const [showModal, setShowModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const selectedTags = tags.filter((tag) => value.includes(tag.id));
  const availableTags = tags.filter(
    (tag) =>
      !value.includes(tag.id) &&
      tag.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAddTag = (tagId: string) => {
    onChange([...value, tagId]);
    setSearchQuery('');
  };

  const handleRemoveTag = (tagId: string) => {
    onChange(value.filter((id) => id !== tagId));
  };

  const handleCreateTag = () => {
    if (!searchQuery.trim()) return;
    
    const newTagId = `tag-${Date.now()}`;
    
    onChange([...value, newTagId]);
    setSearchQuery('');
    setShowModal(false);
  };

  return (
    <View style={styles.container}>
      {label && (
        <Text style={[styles.label, { color: theme.colors.text }]}>{label}</Text>
      )}

      <View style={[styles.tagContainer, { backgroundColor: theme.colors.surface }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.selectedTagsScroll}
        >
          <View style={styles.selectedTagsContainer}>
            {selectedTags.map((tag) => (
              <View
                key={tag.id}
                style={[styles.tag, { backgroundColor: tag.color + '20' }]}
              >
                <Text style={[styles.tagText, { color: tag.color }]}>
                  {tag.name}
                </Text>
                <TouchableOpacity
                  onPress={() => handleRemoveTag(tag.id)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={[styles.tagRemove, { color: tag.color }]}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity
              style={[
                styles.addButton,
                { borderColor: theme.colors.primary },
              ]}
              onPress={() => setShowModal(true)}
            >
              <Text style={[styles.addButtonText, { color: theme.colors.primary }]}>
                + 添加
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>

      <Modal
        visible={showModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}
          >
            <View
              style={[
                styles.modalHeader,
                { borderBottomColor: theme.colors.border },
              ]}
            >
              <Text style={[styles.modalTitle, { color: theme.colors.text }]}>
                添加标签
              </Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Text
                  style={[
                    styles.modalClose,
                    { color: theme.colors.textSecondary },
                  ]}
                >
                  ×
                </Text>
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.searchContainer,
                { backgroundColor: theme.colors.background },
              ]}
            >
              <TextInput
                style={[styles.searchInput, { color: theme.colors.text }]}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="搜索或创建标签..."
                placeholderTextColor={theme.colors.textSecondary}
                autoFocus
              />
            </View>

            <ScrollView style={styles.tagList}>
              {availableTags.length > 0 && (
                <View style={styles.tagListSection}>
                  <Text
                    style={[
                      styles.sectionTitle,
                      { color: theme.colors.textSecondary },
                    ]}
                  >
                    已有标签
                  </Text>
                  {availableTags.map((tag) => (
                    <TouchableOpacity
                      key={tag.id}
                      style={styles.tagOption}
                      onPress={() => {
                        handleAddTag(tag.id);
                        setShowModal(false);
                      }}
                    >
                      <View
                        style={[
                          styles.tagDot,
                          { backgroundColor: tag.color },
                        ]}
                      />
                      <Text
                        style={[styles.tagOptionText, { color: theme.colors.text }]}
                      >
                        {tag.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {searchQuery.trim() && (
                <View style={styles.tagListSection}>
                  <Text
                    style={[
                      styles.sectionTitle,
                      { color: theme.colors.textSecondary },
                    ]}
                  >
                    创建新标签
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.createOption,
                      { backgroundColor: theme.colors.primary + '10' },
                    ]}
                    onPress={handleCreateTag}
                  >
                    <Text
                      style={[
                        styles.createOptionText,
                        { color: theme.colors.primary },
                      ]}
                    >
                      + 创建 "{searchQuery.trim()}"
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {availableTags.length === 0 && !searchQuery.trim() && (
                <View style={styles.emptyState}>
                  <Text
                    style={[
                      styles.emptyText,
                      { color: theme.colors.textSecondary },
                    ]}
                  >
                    输入关键词搜索或创建新标签
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  tagContainer: {
    borderRadius: 8,
    padding: 12,
  },
  selectedTagsScroll: {
    flexGrow: 0,
  },
  selectedTagsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  tagText: {
    fontSize: 13,
    fontWeight: '500',
    marginRight: 4,
  },
  tagRemove: {
    fontSize: 18,
    fontWeight: '600',
  },
  addButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  addButtonText: {
    fontSize: 13,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    borderRadius: 12,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  modalClose: {
    fontSize: 28,
    lineHeight: 28,
  },
  searchContainer: {
    padding: 12,
  },
  searchInput: {
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  tagList: {
    maxHeight: 400,
  },
  tagListSection: {
    padding: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  tagOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  tagDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  tagOptionText: {
    fontSize: 14,
  },
  createOption: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  createOptionText: {
    fontSize: 14,
    fontWeight: '500',
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
});
