/**
 * ProjectDetailPage — Single project view with tabs (Sessions, Tasks, Agents).
 * Ported from web's /projects/[id]/page.tsx.
 */

import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  ActivityIndicator,
  Keyboard,
  Text as RNText,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetView,
  BottomSheetTextInput,
  TouchableOpacity as BottomSheetTouchable,
} from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { useThemeColors } from '@/lib/theme-colors';
import {
  FolderGit2,
  MessageSquare,
  ListTodo,
  Cpu,
  Clock,
  Trash2,
  Pencil,
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
  Ban,
  FolderOpen,
} from 'lucide-react-native';

import { useSandboxContext } from '@/contexts/SandboxContext';
import {
  useKortixProject,
  useKortixProjectSessions,
  useKortixTasks,
  useKortixAgents,
  useUpdateProject,
  useDeleteProject,
  type KortixTask,
  type KortixAgent,
} from '@/lib/kortix';
import { useTabStore } from '@/stores/tab-store';

// ── Helpers ──────────────────────────────────────────────────────────────────

function ago(t?: string | number) {
  if (!t) return '';
  const ms = Date.now() - (typeof t === 'string' ? +new Date(t) : t);
  const m = ms / 60000 | 0;
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = m / 60 | 0;
  if (h < 24) return h + 'h ago';
  const d = h / 24 | 0;
  return d < 30 ? d + 'd ago' : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

type Tab = 'sessions' | 'tasks' | 'agents';

const STATUS_CONFIG: Record<string, { icon: typeof Circle; color: string }> = {
  pending: { icon: Circle, color: '#71717a' },
  in_progress: { icon: Loader2, color: '#60a5fa' },
  running: { icon: Loader2, color: '#60a5fa' },
  done: { icon: CheckCircle2, color: '#22c55e' },
  completed: { icon: CheckCircle2, color: '#22c55e' },
  blocked: { icon: AlertTriangle, color: '#f59e0b' },
  failed: { icon: AlertTriangle, color: '#ef4444' },
  cancelled: { icon: Ban, color: '#71717a' },
  stopped: { icon: Ban, color: '#71717a' },
};

const PRIORITY_COLORS: Record<string, { bg: string; fg: string }> = {
  high: { bg: 'rgba(239,68,68,0.1)', fg: '#ef4444' },
  medium: { bg: 'rgba(245,158,11,0.1)', fg: '#f59e0b' },
  low: { bg: 'rgba(96,165,250,0.1)', fg: '#60a5fa' },
};

// ── Types ────────────────────────────────────────────────────────────────────

interface ProjectDetailPageProps {
  projectId: string;
  onBack: () => void;
  onOpenDrawer?: () => void;
  onOpenRightDrawer?: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ProjectDetailPage({ projectId, onBack, onOpenDrawer, onOpenRightDrawer }: ProjectDetailPageProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const { sandboxUrl } = useSandboxContext();
  const themeColors = useThemeColors();

  const { data: project, isLoading, refetch } = useKortixProject(sandboxUrl, projectId);
  const { data: sessions } = useKortixProjectSessions(sandboxUrl, projectId);
  const { data: tasks } = useKortixTasks(sandboxUrl, project?.id);
  const { data: agents } = useKortixAgents(sandboxUrl, project?.id);
  const updateProject = useUpdateProject(sandboxUrl);
  const deleteProject = useDeleteProject(sandboxUrl);

  const [tab, setTab] = useState<Tab>('sessions');
  const editSheetRef = useRef<BottomSheetModal>(null);
  const [editField, setEditField] = useState<'name' | 'description'>('name');
  const [editValue, setEditValue] = useState('');

  const fg = isDark ? '#F8F8F8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const mutedStrong = isDark ? '#a1a1aa' : '#71717a';
  const cardBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const bg = isDark ? '#121215' : '#F8F8F8';

  const sessionList = sessions ?? [];
  const taskList = tasks ?? [];
  const agentList = agents ?? [];

  const taskStats = useMemo(() => {
    const done = taskList.filter(t => t.status === 'done').length;
    const inProgress = taskList.filter(t => t.status === 'in_progress').length;
    const pending = taskList.filter(t => t.status === 'pending').length;
    return { done, inProgress, pending, total: taskList.length };
  }, [taskList]);

  const tabs: Array<{ id: Tab; label: string; count: number; icon: typeof MessageSquare }> = [
    { id: 'sessions', label: 'Sessions', count: sessionList.length, icon: MessageSquare },
    { id: 'tasks', label: 'Tasks', count: taskList.length, icon: ListTodo },
    { id: 'agents', label: 'Agents', count: agentList.length, icon: Cpu },
  ];

  const handleSessionPress = useCallback((sessionId: string) => {
    useTabStore.getState().navigateToSession(sessionId);
  }, []);

  const handleAgentPress = useCallback((sessionId: string) => {
    useTabStore.getState().navigateToSession(sessionId);
  }, []);

  const handleEdit = useCallback((field: 'name' | 'description') => {
    if (!project) return;
    setEditField(field);
    setEditValue(field === 'name' ? project.name : (project.description || ''));
    editSheetRef.current?.present();
  }, [project]);

  const handleSaveEdit = useCallback(() => {
    if (!project) return;
    const trimmed = editValue.trim();
    if (editField === 'name' && !trimmed) return;
    Keyboard.dismiss();
    updateProject.mutate(
      { id: project.id, [editField]: trimmed },
      {
        onSuccess: () => {
          editSheetRef.current?.dismiss();
          setEditValue('');
        },
      },
    );
  }, [project, editField, editValue, updateProject]);

  const handleDelete = useCallback(() => {
    if (!project) return;
    Alert.alert(
      'Delete Project',
      `Remove "${project.name}" from registry? Files on disk will NOT be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteProject.mutate(project.id, { onSuccess: onBack });
          },
        },
      ],
    );
  }, [project, deleteProject, onBack]);

  const renderBackdrop = useMemo(
    () => (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.35} />
    ),
    [],
  );

  // Loading
  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={muted} />
      </View>
    );
  }

  // Not found
  if (!project) {
    return (
      <View style={{ flex: 1, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <FolderGit2 size={48} color={isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'} style={{ marginBottom: 12 }} />
        <RNText style={{ fontSize: 15, fontFamily: 'Roobert-Medium', color: muted }}>Project not found</RNText>
        <TouchableOpacity onPress={onBack} style={{ marginTop: 12 }}>
          <RNText style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: isDark ? '#60a5fa' : '#2563eb' }}>Go back</RNText>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {onOpenDrawer && (
            <TouchableOpacity onPress={onOpenDrawer} style={{ marginRight: 12, padding: 4 }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="menu" size={24} color={fg} />
            </TouchableOpacity>
          )}

          {/* Project name + path */}
          <View style={{ flex: 1 }}>
            <TouchableOpacity onPress={() => handleEdit('name')} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <FolderGit2 size={16} color={mutedStrong} />
              <Text style={{ fontSize: 17, fontFamily: 'Roobert-SemiBold', color: fg }} numberOfLines={1}>
                {project.name}
              </Text>
              <Pencil size={12} color={isDark ? '#3f3f46' : '#d4d4d8'} />
            </TouchableOpacity>
            {project.path && project.path !== '/' && (
              <RNText numberOfLines={1} style={{ fontSize: 11, fontFamily: 'Menlo', color: isDark ? '#3f3f46' : '#a1a1aa', marginTop: 2, marginLeft: 22 }}>
                {project.path}
              </RNText>
            )}
          </View>

          {/* Actions */}
          <TouchableOpacity onPress={handleDelete} style={{ padding: 6, marginRight: 4 }} hitSlop={8}>
            <Trash2 size={18} color={isDark ? '#52525b' : '#a1a1aa'} />
          </TouchableOpacity>
          {onOpenRightDrawer && (
            <TouchableOpacity onPress={onOpenRightDrawer} style={{ padding: 4 }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="apps-outline" size={20} color={fg} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tab bar */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: border }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          const Icon = t.icon;
          return (
            <TouchableOpacity
              key={t.id}
              onPress={() => setTab(t.id)}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderBottomWidth: 2,
                borderBottomColor: active ? (isDark ? '#e4e4e7' : '#18181b') : 'transparent',
              }}
            >
              <Icon size={14} color={active ? fg : mutedStrong} />
              <RNText style={{ fontSize: 13, fontFamily: active ? 'Roobert-Medium' : 'Roobert', color: active ? fg : mutedStrong }}>
                {t.label}
              </RNText>
              {t.count > 0 && (
                <View style={{
                  backgroundColor: active ? (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)') : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'),
                  borderRadius: 10,
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                }}>
                  <RNText style={{ fontSize: 11, fontFamily: 'Roobert', color: active ? fg : mutedStrong }}>{t.count}</RNText>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      <ScrollView
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={muted} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        {/* ── Sessions Tab ── */}
        {tab === 'sessions' && (
          sessionList.length === 0 ? (
            <EmptyState icon={MessageSquare} text="No sessions linked" sub="Sessions appear when you use project_select" isDark={isDark} />
          ) : (
            <View style={{ borderRadius: 12, borderWidth: 1, borderColor: border, backgroundColor: cardBg, overflow: 'hidden' }}>
              {sessionList.map((s: any, i: number) => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => handleSessionPress(s.id)}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    gap: 10,
                    borderBottomWidth: i < sessionList.length - 1 ? 1 : 0,
                    borderBottomColor: border,
                  }}
                >
                  <MessageSquare size={14} color={isDark ? '#3f3f46' : '#d4d4d8'} />
                  <RNText numberOfLines={1} style={{ flex: 1, fontSize: 14, fontFamily: 'Roobert', color: fg }}>
                    {s.title || 'Untitled'}
                  </RNText>
                  <RNText style={{ fontSize: 11, fontFamily: 'Roobert', color: isDark ? '#3f3f46' : '#a1a1aa' }}>
                    {ago(s.time?.updated)}
                  </RNText>
                </TouchableOpacity>
              ))}
            </View>
          )
        )}

        {/* ── Tasks Tab ── */}
        {tab === 'tasks' && (
          taskList.length === 0 ? (
            <EmptyState icon={ListTodo} text="No tasks yet" sub="Tasks appear as the agent works on this project" isDark={isDark} />
          ) : (
            <>
              {/* Progress bar */}
              {taskStats.total > 0 && (
                <View style={{ marginBottom: 14 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                    <RNText style={{ fontSize: 12, fontFamily: 'Roobert', color: mutedStrong }}>
                      {Math.round((taskStats.done / taskStats.total) * 100)}% complete
                    </RNText>
                    <RNText style={{ fontSize: 12, fontFamily: 'Roobert', color: mutedStrong }}>
                      {taskStats.done}/{taskStats.total}
                    </RNText>
                  </View>
                  <View style={{ height: 6, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 3, overflow: 'hidden' }}>
                    <View style={{ height: '100%', width: `${(taskStats.done / taskStats.total) * 100}%`, backgroundColor: '#22c55e', borderRadius: 3 }} />
                  </View>
                </View>
              )}

              <View style={{ borderRadius: 12, borderWidth: 1, borderColor: border, backgroundColor: cardBg, overflow: 'hidden' }}>
                {taskList.map((t: KortixTask, i: number) => {
                  const sc = STATUS_CONFIG[t.status] || STATUS_CONFIG.pending;
                  const StatusIcon = sc.icon;
                  const isDone = t.status === 'done' || t.status === 'cancelled';
                  const pc = PRIORITY_COLORS[t.priority];
                  return (
                    <View
                      key={t.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 14,
                        paddingVertical: 11,
                        gap: 10,
                        borderBottomWidth: i < taskList.length - 1 ? 1 : 0,
                        borderBottomColor: border,
                        opacity: isDone ? 0.4 : 1,
                      }}
                    >
                      <StatusIcon size={14} color={sc.color} />
                      <RNText
                        numberOfLines={1}
                        style={{
                          flex: 1,
                          fontSize: 14,
                          fontFamily: 'Roobert',
                          color: fg,
                          textDecorationLine: isDone ? 'line-through' : 'none',
                        }}
                      >
                        {t.title}
                      </RNText>
                      {pc && t.priority !== 'medium' && (
                        <View style={{ backgroundColor: pc.bg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <RNText style={{ fontSize: 10, fontFamily: 'Roobert-Medium', color: pc.fg }}>{t.priority}</RNText>
                        </View>
                      )}
                      <RNText style={{ fontSize: 11, fontFamily: 'Roobert', color: isDark ? '#3f3f46' : '#a1a1aa' }}>
                        {ago(t.updated_at)}
                      </RNText>
                    </View>
                  );
                })}
              </View>
            </>
          )
        )}

        {/* ── Agents Tab ── */}
        {tab === 'agents' && (
          agentList.length === 0 ? (
            <EmptyState icon={Cpu} text="No agents spawned" sub="Agents appear when Kortix delegates work" isDark={isDark} />
          ) : (
            <View style={{ borderRadius: 12, borderWidth: 1, borderColor: border, backgroundColor: cardBg, overflow: 'hidden' }}>
              {agentList.map((a: KortixAgent, i: number) => {
                const sc = STATUS_CONFIG[a.status] || STATUS_CONFIG.running;
                const StatusIcon = sc.icon;
                return (
                  <TouchableOpacity
                    key={a.id}
                    onPress={() => handleAgentPress(a.session_id)}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 14,
                      paddingVertical: 11,
                      gap: 10,
                      borderBottomWidth: i < agentList.length - 1 ? 1 : 0,
                      borderBottomColor: border,
                    }}
                  >
                    <StatusIcon size={14} color={sc.color} />
                    <View style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                      <RNText style={{ fontSize: 10, fontFamily: 'Menlo', color: mutedStrong }}>{a.agent_type}</RNText>
                    </View>
                    <RNText numberOfLines={1} style={{ flex: 1, fontSize: 13, fontFamily: 'Roobert', color: fg }}>
                      {a.description || 'Agent'}
                    </RNText>
                    <RNText style={{ fontSize: 11, fontFamily: 'Roobert', color: isDark ? '#3f3f46' : '#a1a1aa' }}>
                      {ago(a.created_at)}
                    </RNText>
                  </TouchableOpacity>
                );
              })}
            </View>
          )
        )}

        {/* ── About section (below tabs on mobile) ── */}
        <View style={{ marginTop: 20, gap: 10 }}>
          {/* Description */}
          <TouchableOpacity onPress={() => handleEdit('description')} activeOpacity={0.7}>
            {project.description ? (
              <RNText style={{ fontSize: 14, fontFamily: 'Roobert', color: isDark ? '#a1a1aa' : '#52525b', lineHeight: 20 }}>
                {project.description}
              </RNText>
            ) : (
              <RNText style={{ fontSize: 13, fontFamily: 'Roobert', color: isDark ? '#3f3f46' : '#a1a1aa', fontStyle: 'italic' }}>
                No description — tap to add
              </RNText>
            )}
          </TouchableOpacity>

          {/* Meta */}
          <View style={{ gap: 6 }}>
            {project.path && project.path !== '/' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <FolderOpen size={13} color={isDark ? '#3f3f46' : '#a1a1aa'} />
                <RNText style={{ fontSize: 12, fontFamily: 'Menlo', color: isDark ? '#52525b' : '#a1a1aa' }}>{project.path}</RNText>
              </View>
            )}
            {project.created_at && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Clock size={13} color={isDark ? '#3f3f46' : '#a1a1aa'} />
                <RNText style={{ fontSize: 12, fontFamily: 'Roobert', color: isDark ? '#52525b' : '#a1a1aa' }}>Created {ago(project.created_at)}</RNText>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Edit sheet — matches FilesPage rename sheet pattern */}
      <BottomSheetModal
        ref={editSheetRef}
        enableDynamicSizing
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        onDismiss={() => { setEditValue(''); }}
        backgroundStyle={{
          backgroundColor: isDark ? '#161618' : '#FFFFFF',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
        }}
        handleIndicatorStyle={{
          backgroundColor: isDark ? '#3F3F46' : '#D4D4D8',
          width: 36,
          height: 5,
          borderRadius: 3,
        }}
      >
        <BottomSheetView
          style={{
            paddingHorizontal: 24,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 20) + 16,
          }}
        >
          {/* Header */}
          <View className="flex-row items-center mb-5">
            <View
              className="w-10 h-10 rounded-xl items-center justify-center mr-3"
              style={{
                backgroundColor: isDark
                  ? 'rgba(248, 248, 248, 0.08)'
                  : 'rgba(18, 18, 21, 0.05)',
              }}
            >
              <Icon
                as={editField === 'name' ? FolderGit2 : Pencil}
                size={20}
                color={fg}
                strokeWidth={1.8}
              />
            </View>
            <View className="flex-1">
              <Text
                className="text-lg font-roobert-semibold"
                style={{ color: fg }}
              >
                {editField === 'name' ? 'Rename' : 'Edit description'}
              </Text>
              <Text
                className="text-xs font-roobert mt-0.5"
                style={{
                  color: isDark
                    ? 'rgba(248, 248, 248, 0.4)'
                    : 'rgba(18, 18, 21, 0.4)',
                }}
                numberOfLines={1}
              >
                {project?.name}
              </Text>
            </View>
          </View>

          {/* Input */}
          <BottomSheetTextInput
            value={editValue}
            onChangeText={setEditValue}
            placeholder={editField === 'name' ? 'Enter project name' : 'Enter description'}
            placeholderTextColor={isDark ? 'rgba(248, 248, 248, 0.25)' : 'rgba(18, 18, 21, 0.3)'}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            multiline={editField === 'description'}
            returnKeyType={editField === 'name' ? 'done' : 'default'}
            onSubmitEditing={editField === 'name' ? handleSaveEdit : undefined}
            style={{
              backgroundColor: isDark
                ? 'rgba(248, 248, 248, 0.06)'
                : 'rgba(18, 18, 21, 0.04)',
              borderWidth: 1,
              borderColor: isDark
                ? 'rgba(248, 248, 248, 0.1)'
                : 'rgba(18, 18, 21, 0.08)',
              borderRadius: 14,
              paddingHorizontal: 16,
              paddingVertical: 14,
              fontSize: 16,
              fontFamily: 'Roobert',
              color: fg,
              marginBottom: 20,
              minHeight: editField === 'description' ? 80 : undefined,
              textAlignVertical: editField === 'description' ? 'top' : 'center',
            }}
          />

          {/* Save button */}
          {(() => {
            const canSave = !!editValue.trim() && (editField !== 'name' || editValue.trim() !== project?.name);
            return (
              <BottomSheetTouchable
                onPress={handleSaveEdit}
                disabled={!canSave || updateProject.isPending}
                style={{
                  backgroundColor: canSave
                    ? themeColors.primary
                    : isDark
                      ? 'rgba(248, 248, 248, 0.08)'
                      : 'rgba(18, 18, 21, 0.06)',
                  borderRadius: 14,
                  paddingVertical: 15,
                  alignItems: 'center',
                  opacity: canSave ? 1 : 0.5,
                }}
              >
                <Text
                  className="text-[15px] font-roobert-semibold"
                  style={{
                    color: canSave
                      ? themeColors.primaryForeground
                      : isDark
                        ? 'rgba(248, 248, 248, 0.3)'
                        : 'rgba(18, 18, 21, 0.3)',
                  }}
                >
                  {updateProject.isPending ? 'Saving...' : 'Save'}
                </Text>
              </BottomSheetTouchable>
            );
          })()}
        </BottomSheetView>
      </BottomSheetModal>
    </View>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, text, sub, isDark }: { icon: typeof ListTodo; text: string; sub?: string; isDark: boolean }) {
  const muted = isDark ? 'rgba(248,248,248,0.3)' : 'rgba(18,18,21,0.25)';
  return (
    <View style={{ padding: 40, alignItems: 'center' }}>
      <Icon size={32} color={isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'} style={{ marginBottom: 10 }} />
      <RNText style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 4 }}>{text}</RNText>
      {sub && <RNText style={{ fontSize: 12, fontFamily: 'Roobert', color: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)', textAlign: 'center' }}>{sub}</RNText>}
    </View>
  );
}
