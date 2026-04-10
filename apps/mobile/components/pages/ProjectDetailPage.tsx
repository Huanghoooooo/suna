/**
 * ProjectDetailPage — Single project view with tabs (Sessions, Tasks, Agents).
 * Ported from web's /projects/[id]/page.tsx.
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
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
  Code2,
} from 'lucide-react-native';

import { FileItem } from '@/components/files/FileItem';
import { FileViewer } from '@/components/files/FileViewer';
import { useOpenCodeFiles } from '@/lib/files/hooks';
import type { SandboxFile } from '@/api/types';

import { useSandboxContext } from '@/contexts/SandboxContext';
import { useSheetBottomPadding } from '@/hooks/useSheetKeyboard';
import {
  useKortixProject,
  useKortixProjectSessions,
  useKortixTasks,
  useKortixAgents,
  useUpdateProject,
  useDeleteProject,
  useUpdateKortixTask,
  useDeleteKortixTask,
  type KortixTask,
  type KortixAgent,
  type KortixTaskStatus,
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

type Tab = 'files' | 'sessions' | 'tasks' | 'agents' | 'about';

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
  const updateTask = useUpdateKortixTask(sandboxUrl);
  const deleteTask = useDeleteKortixTask(sandboxUrl);

  // Store project name in tab state for TabsOverview title
  useEffect(() => {
    if (project?.name) {
      useTabStore.getState().setTabState(`page:project:${projectId}`, { projectName: project.name });
    }
  }, [project?.name, projectId]);

  const [tab, setTab] = useState<Tab>('files');
  const editSheetRef = useRef<BottomSheetModal>(null);
  const taskSheetRef = useRef<BottomSheetModal>(null);
  const sheetPadding = useSheetBottomPadding();
  const tabScrollRef = useRef<ScrollView>(null);
  const tabLayoutsRef = useRef<Record<number, { x: number; width: number }>>({});
  const [editField, setEditField] = useState<'name' | 'description'>('name');
  const [editValue, setEditValue] = useState('');
  const [selectedTask, setSelectedTask] = useState<KortixTask | null>(null);

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

  // Files tab state
  const hasFiles = !!project?.path && project.path !== '/';
  const [filePath, setFilePath] = useState(project?.path || '/workspace');
  const { data: files, isLoading: filesLoading, refetch: refetchFiles } = useOpenCodeFiles(
    hasFiles && tab === 'files' ? sandboxUrl : undefined,
    filePath,
  );
  const [viewerFile, setViewerFile] = useState<SandboxFile | null>(null);
  const [viewerVisible, setViewerVisible] = useState(false);

  // Reset file path when project changes
  useEffect(() => {
    if (project?.path) setFilePath(project.path);
  }, [project?.path]);

  const { folders, regularFiles } = useMemo(() => {
    if (!files || !Array.isArray(files)) return { folders: [], regularFiles: [] };
    const sort = (a: SandboxFile, b: SandboxFile) => a.name.localeCompare(b.name);
    return {
      folders: files.filter((f: SandboxFile) => f.type === 'directory' && !f.name.startsWith('.')).sort(sort),
      regularFiles: files.filter((f: SandboxFile) => f.type === 'file' && !f.name.startsWith('.')).sort(sort),
    };
  }, [files]);

  const handleFilePress = useCallback((file: SandboxFile) => {
    if (file.type === 'directory') {
      setFilePath(file.path);
    } else {
      setViewerFile(file);
      setViewerVisible(true);
    }
  }, []);

  // Navigate up in file tree
  const canGoUp = hasFiles && filePath !== project?.path;
  const handleFileGoUp = useCallback(() => {
    const parent = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
    setFilePath(parent);
  }, [filePath]);

  const tabs: Array<{ id: Tab; label: string; count: number; icon: typeof MessageSquare }> = [
    ...(hasFiles ? [{ id: 'files' as Tab, label: 'Files', count: 0, icon: Code2 }] : []),
    { id: 'sessions', label: 'Sessions', count: sessionList.length, icon: MessageSquare },
    { id: 'tasks', label: 'Tasks', count: taskList.length, icon: ListTodo },
    { id: 'agents', label: 'Agents', count: agentList.length, icon: Cpu },
    { id: 'about', label: 'About', count: 0, icon: FolderOpen },
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
        {/* Top row: menu + name + actions — all centered on one line */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {onOpenDrawer && (
            <TouchableOpacity onPress={onOpenDrawer} style={{ marginRight: 12, padding: 4 }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="menu" size={24} color={fg} />
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={() => handleEdit('name')} activeOpacity={0.7} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <FolderGit2 size={16} color={mutedStrong} />
            <Text style={{ fontSize: 17, fontFamily: 'Roobert-SemiBold', color: fg, flexShrink: 1 }} numberOfLines={1}>
              {project.name}
            </Text>
            <Pencil size={12} color={isDark ? '#3f3f46' : '#d4d4d8'} />
          </TouchableOpacity>

          <TouchableOpacity onPress={handleDelete} style={{ padding: 6, marginLeft: 4 }} hitSlop={8}>
            <Trash2 size={18} color={isDark ? '#52525b' : '#a1a1aa'} />
          </TouchableOpacity>
          {onOpenRightDrawer && (
            <TouchableOpacity onPress={onOpenRightDrawer} style={{ padding: 4 }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="apps-outline" size={20} color={fg} />
            </TouchableOpacity>
          )}
        </View>

        {/* Path removed from header — now in About tab */}
      </View>

      {/* Tab bar */}
      <ScrollView
        ref={tabScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ borderBottomWidth: 1, borderBottomColor: border, flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16 }}
      >
        {tabs.map((t, index) => {
          const active = tab === t.id;
          const Icon = t.icon;
          return (
            <TouchableOpacity
              key={t.id}
              onLayout={(e) => {
                tabLayoutsRef.current[index] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
              }}
              onPress={() => {
                setTab(t.id);
                const layout = tabLayoutsRef.current[index];
                if (layout && tabScrollRef.current) {
                  tabScrollRef.current.scrollTo({ x: Math.max(0, layout.x - 16), animated: true });
                }
              }}
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
      </ScrollView>

      {/* Content */}
      <ScrollView
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={muted} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        {/* ── Files Tab ── */}
        {tab === 'files' && (
          hasFiles ? (
            <View>
              {/* Breadcrumb / back navigation */}
              {canGoUp && (
                <TouchableOpacity
                  onPress={handleFileGoUp}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingVertical: 8,
                    paddingHorizontal: 4,
                    marginBottom: 4,
                  }}
                >
                  <Ionicons name="arrow-back" size={16} color={mutedStrong} />
                  <RNText style={{ fontSize: 12, fontFamily: 'Menlo', color: mutedStrong }} numberOfLines={1}>
                    {filePath.split('/').pop() || filePath}
                  </RNText>
                </TouchableOpacity>
              )}

              {filesLoading && folders.length === 0 && regularFiles.length === 0 && (
                <View style={{ padding: 30, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={muted} />
                </View>
              )}

              {/* Folders */}
              {folders.length > 0 && (
                <View style={{ marginBottom: 8 }}>
                  {folders.map((file: SandboxFile) => (
                    <FileItem key={file.path} file={file} onPress={handleFilePress} />
                  ))}
                </View>
              )}

              {/* Files */}
              {regularFiles.length > 0 && (
                <View>
                  {regularFiles.map((file: SandboxFile) => (
                    <FileItem key={file.path} file={file} onPress={handleFilePress} />
                  ))}
                </View>
              )}

              {!filesLoading && folders.length === 0 && regularFiles.length === 0 && (
                <EmptyState icon={FolderOpen} text="Empty directory" isDark={isDark} />
              )}
            </View>
          ) : (
            <EmptyState icon={FolderOpen} text="No project path configured" sub="This project doesn't have a file path" isDark={isDark} />
          )
        )}

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
                    <TouchableOpacity
                      key={t.id}
                      onPress={() => {
                        setSelectedTask(t);
                        taskSheetRef.current?.present();
                      }}
                      activeOpacity={0.7}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 14,
                        paddingVertical: 11,
                        gap: 10,
                        borderBottomWidth: i < taskList.length - 1 ? 1 : 0,
                        borderBottomColor: border,
                        opacity: isDone ? 0.5 : 1,
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
                    </TouchableOpacity>
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

        {/* ── About Tab ── */}
        {tab === 'about' && (
          <View style={{ gap: 16 }}>
            {/* Description */}
            <View style={{ borderRadius: 12, borderWidth: 1, borderColor: border, backgroundColor: cardBg, padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <RNText style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: fg }}>Description</RNText>
                <TouchableOpacity onPress={() => handleEdit('description')} hitSlop={8}>
                  <Pencil size={14} color={mutedStrong} />
                </TouchableOpacity>
              </View>
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
            </View>

            {/* Details */}
            <View style={{ borderRadius: 12, borderWidth: 1, borderColor: border, backgroundColor: cardBg, padding: 14, gap: 10 }}>
              <RNText style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: fg, marginBottom: 2 }}>Details</RNText>
              {project.path && project.path !== '/' && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <FolderOpen size={14} color={mutedStrong} />
                  <RNText style={{ fontSize: 13, fontFamily: 'Menlo', color: isDark ? '#71717a' : '#a1a1aa' }}>{project.path}</RNText>
                </View>
              )}
              {project.created_at && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Clock size={14} color={mutedStrong} />
                  <RNText style={{ fontSize: 13, fontFamily: 'Roobert', color: isDark ? '#71717a' : '#a1a1aa' }}>Created {ago(project.created_at)}</RNText>
                </View>
              )}
              {sessionList.length > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <MessageSquare size={14} color={mutedStrong} />
                  <RNText style={{ fontSize: 13, fontFamily: 'Roobert', color: isDark ? '#71717a' : '#a1a1aa' }}>
                    {sessionList.length} session{sessionList.length !== 1 ? 's' : ''}
                  </RNText>
                </View>
              )}
              {agentList.length > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Cpu size={14} color={mutedStrong} />
                  <RNText style={{ fontSize: 13, fontFamily: 'Roobert', color: isDark ? '#71717a' : '#a1a1aa' }}>
                    {agentList.length} agent{agentList.length !== 1 ? 's' : ''}
                  </RNText>
                </View>
              )}
              {taskStats.total > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <ListTodo size={14} color={mutedStrong} />
                  <RNText style={{ fontSize: 13, fontFamily: 'Roobert', color: isDark ? '#71717a' : '#a1a1aa' }}>
                    {taskStats.done}/{taskStats.total} tasks complete
                  </RNText>
                </View>
              )}
              {project.opencode_id && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <FolderGit2 size={14} color={mutedStrong} />
                  <RNText style={{ fontSize: 12, fontFamily: 'Menlo', color: isDark ? '#52525b' : '#a1a1aa' }}>{project.opencode_id}</RNText>
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* File Viewer */}
      {viewerFile && (
        <FileViewer
          visible={viewerVisible}
          onClose={() => { setViewerVisible(false); setViewerFile(null); }}
          file={viewerFile}
          sandboxId={''}
          sandboxUrl={sandboxUrl}
        />
      )}

      {/* Task detail sheet — view & edit task status */}
      <BottomSheetModal
        ref={taskSheetRef}
        enableDynamicSizing
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        onDismiss={() => setSelectedTask(null)}
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
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: sheetPadding,
          }}
        >
          {selectedTask && (
            <>
              {/* Header: title + delete */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
                <RNText
                  style={{
                    flex: 1,
                    fontSize: 17,
                    fontFamily: 'Roobert-Medium',
                    color: fg,
                    lineHeight: 22,
                    textDecorationLine: (selectedTask.status === 'done' || selectedTask.status === 'cancelled') ? 'line-through' : 'none',
                  }}
                >
                  {selectedTask.title}
                </RNText>
                <TouchableOpacity
                  onPress={() => {
                    Alert.alert(
                      'Delete task',
                      `Delete "${selectedTask.title}"? This cannot be undone.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () => {
                            deleteTask.mutate(selectedTask.id, {
                              onSuccess: () => {
                                taskSheetRef.current?.dismiss();
                              },
                            });
                          },
                        },
                      ],
                    );
                  }}
                  hitSlop={10}
                  style={{ padding: 4 }}
                >
                  <Trash2 size={18} color={isDark ? '#52525b' : '#a1a1aa'} />
                </TouchableOpacity>
              </View>

              {/* Priority */}
              {selectedTask.priority && (() => {
                const pc = PRIORITY_COLORS[selectedTask.priority];
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <RNText style={{ fontSize: 12, fontFamily: 'Roobert', color: mutedStrong }}>
                      Priority
                    </RNText>
                    <View style={{ backgroundColor: pc?.bg || cardBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <RNText style={{ fontSize: 11, fontFamily: 'Roobert-Medium', color: pc?.fg || mutedStrong, textTransform: 'capitalize' }}>
                        {selectedTask.priority}
                      </RNText>
                    </View>
                  </View>
                );
              })()}

              {/* Description */}
              {!!selectedTask.description && (
                <View style={{ marginBottom: 16 }}>
                  <RNText style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: mutedStrong, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Description
                  </RNText>
                  <RNText style={{ fontSize: 14, fontFamily: 'Roobert', color: isDark ? '#a1a1aa' : '#52525b', lineHeight: 20 }}>
                    {selectedTask.description}
                  </RNText>
                </View>
              )}

              {/* Status options */}
              <RNText style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: mutedStrong, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Status
              </RNText>
              <View style={{ gap: 6, marginBottom: 16 }}>
                {(['pending', 'in_progress', 'done', 'blocked', 'cancelled'] as KortixTaskStatus[]).map((s) => {
                  const sc = STATUS_CONFIG[s];
                  const SIcon = sc.icon;
                  const isCurrent = selectedTask.status === s;
                  const label = s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1);
                  return (
                    <TouchableOpacity
                      key={s}
                      onPress={() => {
                        if (isCurrent) return;
                        updateTask.mutate(
                          { id: selectedTask.id, status: s },
                          {
                            onSuccess: (updated: KortixTask) => {
                              setSelectedTask(updated);
                            },
                          },
                        );
                      }}
                      activeOpacity={0.7}
                      disabled={updateTask.isPending}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 11,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: isCurrent ? sc.color : border,
                        backgroundColor: isCurrent ? `${sc.color}15` : cardBg,
                      }}
                    >
                      <SIcon size={15} color={sc.color} />
                      <RNText style={{ flex: 1, fontSize: 14, fontFamily: isCurrent ? 'Roobert-Medium' : 'Roobert', color: fg }}>
                        {label}
                      </RNText>
                      {isCurrent && <CheckCircle2 size={14} color={sc.color} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Meta */}
              <View style={{ flexDirection: 'row', gap: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: border }}>
                <RNText style={{ fontSize: 11, fontFamily: 'Roobert', color: muted }}>
                  Created {ago(selectedTask.created_at)}
                </RNText>
                {selectedTask.updated_at !== selectedTask.created_at && (
                  <RNText style={{ fontSize: 11, fontFamily: 'Roobert', color: muted }}>
                    Updated {ago(selectedTask.updated_at)}
                  </RNText>
                )}
              </View>
            </>
          )}
        </BottomSheetView>
      </BottomSheetModal>

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
            paddingBottom: sheetPadding,
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
