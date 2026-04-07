/**
 * ChannelsPage — full-screen channels management with setup wizards.
 * Create, list, enable/disable, edit, and delete channels.
 * Includes Telegram (2-step) and Slack (3-step) setup wizards matching frontend.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  FlatList,
  TextInput,
  Pressable,
  Alert,
  ActivityIndicator,
  Switch,
  StyleSheet,
  Keyboard,
  TouchableOpacity,
  ScrollView,
  Linking,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { Text as RNText } from 'react-native';
import {
  Plus,
  Search,
  X,
  ChevronRight,
  Trash2,
  Radio,
  ArrowRight,
  ArrowLeft,
  Check,
  Globe,
  Shield,
  Copy,
  ExternalLink,
} from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  BottomSheetTextInput,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';

import { useThemeColors } from '@/lib/theme-colors';
import { useSandboxContext } from '@/contexts/SandboxContext';
import type { PageTab } from '@/stores/tab-store';
import {
  useChannels,
  useCreateChannel,
  useUpdateChannel,
  useDeleteChannel,
  useToggleChannel,
  getChannelTypeLabel,
  type ChannelConfig,
  type ChannelType,
} from '@/hooks/useChannels';
import {
  useTelegramVerifyToken,
  useTelegramConnect,
  useSlackGenerateManifest,
  useSlackConnect,
} from '@/hooks/useChannelWizards';
import { useOpenCodeAgents, useOpenCodeProviders, flattenModels, filterToLatestModels } from '@/lib/opencode/hooks/use-opencode-data';

// ─── Channel Type Icons ─────────────────────────────────────────────────────

const CHANNEL_TYPE_ICONS: Record<ChannelType, string> = {
  telegram: 'paper-plane-outline',
  slack: 'logo-slack',
  discord: 'logo-discord',
  whatsapp: 'chatbubble-outline',
  teams: 'people-outline',
  voice: 'mic-outline',
  email: 'mail-outline',
  sms: 'chatbox-outline',
};

function getChannelIcon(type: ChannelType): string {
  return CHANNEL_TYPE_ICONS[type] || 'radio-outline';
}

const SUPPORTED_CHANNEL_TYPES: ChannelType[] = ['telegram', 'slack'];

const ALL_CHANNEL_TYPES: { type: ChannelType; label: string }[] = [
  { type: 'telegram', label: 'Telegram' },
  { type: 'slack', label: 'Slack' },
  { type: 'discord', label: 'Discord' },
  { type: 'whatsapp', label: 'WhatsApp' },
  { type: 'teams', label: 'Teams' },
  { type: 'voice', label: 'Voice' },
  { type: 'email', label: 'Email' },
  { type: 'sms', label: 'SMS' },
];

// ─── Tab Page Wrapper ────────────────────────────────────────────────────────

interface ChannelsTabPageProps {
  page: PageTab;
  onBack: () => void;
  onOpenDrawer?: () => void;
  onOpenRightDrawer?: () => void;
}

export function ChannelsTabPage({
  page,
  onBack,
  onOpenDrawer,
  onOpenRightDrawer,
}: ChannelsTabPageProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const fgColor = isDark ? '#F8F8F8' : '#121215';

  return (
    <View style={{ flex: 1, backgroundColor: isDark ? '#121215' : '#F8F8F8' }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: isDark ? '#121215' : '#F8F8F8' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity
            onPress={onOpenDrawer}
            style={{ marginRight: 12, padding: 4 }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="menu" size={24} color={fgColor} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <RNText style={{ fontSize: 18, fontFamily: 'Roobert-SemiBold', color: fgColor }} numberOfLines={1}>
              {page.label}
            </RNText>
          </View>
          <TouchableOpacity
            onPress={onOpenRightDrawer}
            style={{ marginLeft: 12, padding: 4 }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="apps-outline" size={20} color={fgColor} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      <ChannelsContent />
    </View>
  );
}

// ─── Main Content ────────────────────────────────────────────────────────────

function ChannelsContent() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const theme = useThemeColors();
  const { sandboxUrl, sandboxUuid } = useSandboxContext();

  const { data: channels, isLoading, error, refetch } = useChannels();
  const createChannel = useCreateChannel();
  const deleteChannelMut = useDeleteChannel();
  const toggleChannel = useToggleChannel();
  const updateChannel = useUpdateChannel();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChannel, setSelectedChannel] = useState<ChannelConfig | null>(null);

  const detailSheetRef = useRef<BottomSheetModal>(null);
  const addSheetRef = useRef<BottomSheetModal>(null);

  // Colors
  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const inputBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  // Filter + sort channels
  const filteredChannels = useMemo(() => {
    if (!channels) return [];
    let list = [...channels];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.channelType.toLowerCase().includes(q) ||
          getChannelTypeLabel(c.channelType).toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return list;
  }, [channels, searchQuery]);

  const handleSelectChannel = useCallback((channel: ChannelConfig) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedChannel(channel);
    // Use requestAnimationFrame to ensure state has rendered before presenting
    requestAnimationFrame(() => {
      detailSheetRef.current?.present();
    });
  }, []);

  const handleDelete = useCallback(
    (channel: ChannelConfig) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert('Delete Channel', `Delete "${channel.name}"? This cannot be undone.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteChannelMut.mutateAsync(channel.channelConfigId);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              detailSheetRef.current?.dismiss();
              setSelectedChannel(null);
            } catch {
              Alert.alert('Error', 'Failed to delete channel');
            }
          },
        },
      ]);
    },
    [deleteChannelMut],
  );

  const handleOpenAdd = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addSheetRef.current?.present();
  }, []);

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />,
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChannelConfig }) => (
      <ChannelRow channel={item} isDark={isDark} onPress={() => handleSelectChannel(item)} />
    ),
    [isDark, handleSelectChannel],
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Search Bar */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: inputBg,
            borderRadius: 12,
            paddingHorizontal: 12,
            height: 40,
          }}
        >
          <Search size={16} color={muted} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search channels..."
            placeholderTextColor={muted}
            style={{ flex: 1, marginLeft: 8, fontSize: 14, fontFamily: 'Roobert', color: fg, paddingVertical: 0 }}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={10}>
              <X size={16} color={muted} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Channel List */}
      {isLoading ? (
        <View style={{ padding: 60, alignItems: 'center' }}>
          <ActivityIndicator color={muted} />
        </View>
      ) : error ? (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <Radio size={28} color={muted} />
          <Text style={{ fontSize: 14, fontFamily: 'Roobert', color: muted, marginTop: 12, textAlign: 'center' }}>
            Failed to load channels
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
          >
            <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: fg }}>Try Again</Text>
          </Pressable>
        </View>
      ) : filteredChannels.length === 0 ? (
        <View style={{ padding: 60, alignItems: 'center' }}>
          <Radio size={32} color={muted} />
          <Text style={{ fontSize: 16, fontFamily: 'Roobert-Medium', color: fg, marginTop: 16 }}>
            No channels
          </Text>
          <Text style={{ fontSize: 13, fontFamily: 'Roobert', color: muted, marginTop: 6, textAlign: 'center', lineHeight: 18, paddingHorizontal: 20 }}>
            {searchQuery ? 'No channels match your search.' : 'Connect messaging platforms to receive and respond to messages.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredChannels}
          keyExtractor={(item) => item.channelConfigId}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* FAB */}
      <View style={{ position: 'absolute', bottom: insets.bottom + 24, right: 20 }}>
        <Pressable
          onPress={handleOpenAdd}
          style={{
            width: 56, height: 56, borderRadius: 28,
            backgroundColor: theme.primary,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
          }}
        >
          <Plus size={24} color={theme.primaryForeground} />
        </Pressable>
      </View>

      {/* Detail Sheet */}
      <ChannelDetailSheet
        sheetRef={detailSheetRef}
        channel={selectedChannel}
        isDark={isDark}
        theme={theme}
        onToggle={async (channel, enabled) => {
          try {
            await toggleChannel.mutateAsync({ id: channel.channelConfigId, enabled });
            setSelectedChannel((prev) => prev ? { ...prev, enabled } : null);
          } catch {
            Alert.alert('Error', 'Failed to toggle channel');
          }
        }}
        onSave={async (channel, name) => {
          try {
            await updateChannel.mutateAsync({ id: channel.channelConfigId, data: { name } });
            setSelectedChannel((prev) => prev ? { ...prev, name } : null);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch {
            Alert.alert('Error', 'Failed to update channel');
          }
        }}
        onDelete={handleDelete}
        onClose={() => { detailSheetRef.current?.dismiss(); setSelectedChannel(null); }}
      />

      {/* Add Channel Sheet */}
      <AddChannelSheet
        sheetRef={addSheetRef}
        isDark={isDark}
        theme={theme}
        renderBackdrop={renderBackdrop}
        sandboxUrl={sandboxUrl}
        sandboxUuid={sandboxUuid}
        onCreate={async (data) => {
          try {
            await createChannel.mutateAsync(data);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            addSheetRef.current?.dismiss();
          } catch (err: any) {
            Alert.alert('Error', err?.message || 'Failed to create channel');
          }
        }}
        onCreated={() => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          addSheetRef.current?.dismiss();
        }}
        isCreating={createChannel.isPending}
      />
    </View>
  );
}

// ─── Channel Row ─────────────────────────────────────────────────────────────

function ChannelRow({ channel, isDark, onPress }: { channel: ChannelConfig; isDark: boolean; onPress: () => void }) {
  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';

  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      }}
    >
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={getChannelIcon(channel.channelType) as any} size={18} color={muted} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: fg }} numberOfLines={1}>{channel.name}</Text>
          <ChannelStatusDot enabled={channel.enabled} isDark={isDark} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: muted }}>{getChannelTypeLabel(channel.channelType)}</Text>
          <Text style={{ fontSize: 11, color: muted }}>·</Text>
          <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: muted }}>{channel.sandbox?.name || 'No instance'}</Text>
        </View>
      </View>
      <ChevronRight size={16} color={muted} />
    </Pressable>
  );
}

function ChannelStatusDot({ enabled, isDark }: { enabled: boolean; isDark: boolean }) {
  const color = enabled ? '#34d399' : (isDark ? 'rgba(248,248,248,0.35)' : 'rgba(18,18,21,0.35)');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontSize: 11, fontFamily: 'Roobert', color }}>{enabled ? 'Active' : 'Disabled'}</Text>
    </View>
  );
}

// ─── Channel Detail Sheet ────────────────────────────────────────────────────

function ChannelDetailSheet({
  sheetRef, channel, isDark, theme,
  onToggle, onSave, onDelete, onClose,
}: {
  sheetRef: React.RefObject<BottomSheetModal>;
  channel: ChannelConfig | null;
  isDark: boolean;
  theme: ReturnType<typeof useThemeColors>;
  onToggle: (channel: ChannelConfig, enabled: boolean) => void;
  onSave: (channel: ChannelConfig, name: string) => void;
  onDelete: (channel: ChannelConfig) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [editName, setEditName] = useState('');
  const [nameChanged, setNameChanged] = useState(false);

  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const inputBg = isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.04)';
  const borderColor = isDark ? 'rgba(248,248,248,0.1)' : 'rgba(18,18,21,0.08)';
  const subtleBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';

  useEffect(() => {
    if (channel) {
      setEditName(channel.name);
      setNameChanged(false);
    }
  }, [channel]);

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />,
    [],
  );

  const createdDate = channel ? new Date(channel.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const updatedDate = channel ? new Date(channel.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={['80%']}
      enablePanDownToClose
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: isDark ? '#161618' : '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
      handleIndicatorStyle={{ backgroundColor: isDark ? '#3F3F46' : '#D4D4D8', width: 36, height: 5, borderRadius: 3 }}
    >
      {channel ? (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: Math.max(insets.bottom, 20) + 16 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
            <Ionicons name={getChannelIcon(channel.channelType) as any} size={22} color={fg} />
            {channel.enabled && (
              <View style={{ position: 'absolute', top: -2, right: -2, width: 12, height: 12, borderRadius: 6, backgroundColor: '#34d399', borderWidth: 2, borderColor: isDark ? '#161618' : '#FFFFFF' }} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 18, fontFamily: 'Roobert-Semibold', color: fg }} numberOfLines={1}>{channel.name}</Text>
              <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: channel.enabled ? 'rgba(52,211,153,0.12)' : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') }}>
                <Text style={{ fontSize: 10, fontFamily: 'Roobert-Medium', color: channel.enabled ? '#34d399' : muted }}>{channel.enabled ? 'Active' : 'Disabled'}</Text>
              </View>
            </View>
            <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: muted, marginTop: 2 }}>{getChannelTypeLabel(channel.channelType)}</Text>
          </View>
          <Switch
            value={channel.enabled}
            onValueChange={(val) => onToggle(channel, val)}
            trackColor={{ false: isDark ? '#3F3F46' : '#D4D4D8', true: '#34d399' }}
            thumbColor="#fff"
          />
        </View>

        {/* Name Input */}
        <Text style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Name</Text>
        <TextInput
          value={editName}
          onChangeText={(text) => { setEditName(text); setNameChanged(text.trim() !== (channel.name || '')); }}
          placeholder="Channel name"
          placeholderTextColor={isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.3)'}
          style={{ backgroundColor: inputBg, borderWidth: 1, borderColor, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, fontFamily: 'Roobert', color: fg, marginBottom: 16 }}
        />

        {nameChanged && (
          <Pressable onPress={() => onSave(channel, editName.trim())} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 14, backgroundColor: theme.primary, marginBottom: 16 }}>
            <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: theme.primaryForeground }}>Save Changes</Text>
          </Pressable>
        )}

        {/* Instance */}
        <Text style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Linked Instance</Text>
        <View style={{ borderRadius: 14, backgroundColor: subtleBg, borderWidth: StyleSheet.hairlineWidth, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', marginBottom: 16, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14 }}>
            <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
              <Ionicons name="cube-outline" size={16} color={muted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: fg }}>{channel.sandbox?.name || channel.sandboxId || 'No instance'}</Text>
              <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: muted, marginTop: 2 }}>Channels stay attached to the instance they were created for.</Text>
            </View>
          </View>
        </View>

        {/* Metadata */}
        <Text style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Details</Text>
        <View style={{ borderRadius: 14, backgroundColor: subtleBg, borderWidth: StyleSheet.hairlineWidth, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', marginBottom: 16, overflow: 'hidden' }}>
          <DetailRow label="Type" value={getChannelTypeLabel(channel.channelType)} isDark={isDark} fg={fg} muted={muted} />
          {channel.instructions && <DetailRow label="Instructions" value={channel.instructions} isDark={isDark} fg={fg} muted={muted} />}
          {channel.agentName && <DetailRow label="Agent" value={channel.agentName} isDark={isDark} fg={fg} muted={muted} />}
          <DetailRow label="Created" value={createdDate} isDark={isDark} fg={fg} muted={muted} />
          <DetailRow label="Updated" value={updatedDate} isDark={isDark} fg={fg} muted={muted} last />
        </View>

        {/* Platform Config (webhook URL etc.) */}
        {channel.platformConfig && Object.keys(channel.platformConfig).length > 0 && (
          <>
            <Text style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Configuration</Text>
            <View style={{ borderRadius: 14, backgroundColor: subtleBg, borderWidth: StyleSheet.hairlineWidth, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', marginBottom: 16, overflow: 'hidden' }}>
              {Object.entries(channel.platformConfig).map(([key, value], i, arr) => (
                <DetailRow
                  key={key}
                  label={key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  value={typeof value === 'string' ? value : JSON.stringify(value)}
                  isDark={isDark}
                  fg={fg}
                  muted={muted}
                  last={i === arr.length - 1}
                  mono
                />
              ))}
            </View>
          </>
        )}

        {/* Danger Zone */}
        <View style={{ padding: 14, borderRadius: 14, backgroundColor: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.04)', borderWidth: StyleSheet.hairlineWidth, borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: '#ef4444' }}>Delete Channel</Text>
              <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: isDark ? 'rgba(239,68,68,0.7)' : 'rgba(239,68,68,0.6)', marginTop: 2 }}>Permanently remove this channel</Text>
            </View>
            <Pressable onPress={() => onDelete(channel)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)' }}>
              <Trash2 size={14} color="#ef4444" />
              <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: '#ef4444' }}>Delete</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
      ) : null}
    </BottomSheetModal>
  );
}

// ─── Detail Row (reusable) ───────────────────────────────────────────────────

function DetailRow({ label, value, isDark, fg, muted, last, mono }: {
  label: string; value: string; isDark: boolean; fg: string; muted: string; last?: boolean; mono?: boolean;
}) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 14, paddingVertical: 11,
      borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    }}>
      <Text style={{ fontSize: 13, fontFamily: 'Roobert', color: muted }}>{label}</Text>
      <Text style={{ fontSize: 13, fontFamily: mono ? 'monospace' : 'Roobert-Medium', color: fg, maxWidth: '60%' }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ─── Add Channel Sheet (with wizard routing) ─────────────────────────────────

type WizardView = 'type-select' | 'telegram-wizard' | 'slack-wizard' | 'generic-config';

function AddChannelSheet({
  sheetRef, isDark, theme, renderBackdrop, sandboxUrl, sandboxUuid,
  onCreate, onCreated, isCreating,
}: {
  sheetRef: React.RefObject<BottomSheetModal>;
  isDark: boolean;
  theme: ReturnType<typeof useThemeColors>;
  renderBackdrop: (props: any) => React.ReactElement;
  sandboxUrl?: string;
  sandboxUuid?: string;
  onCreate: (data: { name: string; channel_type: ChannelType }) => void;
  onCreated: () => void;
  isCreating: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<WizardView>('type-select');
  const [selectedType, setSelectedType] = useState<ChannelType | null>(null);
  const [channelName, setChannelName] = useState('');

  const fg = isDark ? '#f8f8f8' : '#121215';
  const muted = isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)';
  const inputBg = isDark ? 'rgba(248,248,248,0.06)' : 'rgba(18,18,21,0.04)';
  const borderColor = isDark ? 'rgba(248,248,248,0.1)' : 'rgba(18,18,21,0.08)';

  const reset = () => { setView('type-select'); setSelectedType(null); setChannelName(''); };

  const handleTypeSelect = (type: ChannelType) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedType(type);
    if (type === 'telegram') setView('telegram-wizard');
    else if (type === 'slack') setView('slack-wizard');
    else setView('generic-config');
  };

  const handleCreate = () => {
    if (!selectedType || !channelName.trim()) return;
    Keyboard.dismiss();
    onCreate({ name: channelName.trim(), channel_type: selectedType });
    reset();
  };

  const title = view === 'telegram-wizard' ? 'Connect Telegram'
    : view === 'slack-wizard' ? 'Connect Slack'
    : view === 'generic-config' && selectedType ? `New ${getChannelTypeLabel(selectedType)} Channel`
    : 'Add Channel';

  const subtitle = view === 'telegram-wizard' ? 'Set up a Telegram bot for your instance'
    : view === 'slack-wizard' ? 'Set up a Slack bot for your instance'
    : view === 'generic-config' ? 'Configure your new channel'
    : 'Choose a messaging platform';

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      onDismiss={reset}
      backgroundStyle={{ backgroundColor: isDark ? '#161618' : '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
      handleIndicatorStyle={{ backgroundColor: isDark ? '#3F3F46' : '#D4D4D8', width: 36, height: 5, borderRadius: 3 }}
    >
      <BottomSheetScrollView
        style={{ maxHeight: 600 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 20) + 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
            {selectedType ? (
              <Ionicons name={getChannelIcon(selectedType) as any} size={20} color={fg} />
            ) : (
              <Radio size={20} color={fg} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontFamily: 'Roobert-Semibold', color: fg }}>{title}</Text>
            <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: muted, marginTop: 2 }}>{subtitle}</Text>
          </View>
        </View>

        {view === 'type-select' && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
            {ALL_CHANNEL_TYPES.map((ct) => {
              const isSupported = SUPPORTED_CHANNEL_TYPES.includes(ct.type);
              return (
                <Pressable
                  key={ct.type}
                  onPress={() => isSupported && handleTypeSelect(ct.type)}
                  disabled={!isSupported}
                  style={{
                    width: '48%' as any, flexGrow: 1, padding: 14, borderRadius: 14,
                    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                    alignItems: 'center', gap: 8, opacity: isSupported ? 1 : 0.5,
                  }}
                >
                  <Ionicons name={getChannelIcon(ct.type) as any} size={24} color={isSupported ? fg : muted} />
                  <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: isSupported ? fg : muted }}>{ct.label}</Text>
                  {!isSupported && (
                    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                      <Text style={{ fontSize: 10, fontFamily: 'Roobert', color: muted }}>Coming Soon</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}

        {view === 'telegram-wizard' && (
          <TelegramWizard
            isDark={isDark}
            theme={theme}
            fg={fg}
            muted={muted}
            inputBg={inputBg}
            borderColor={borderColor}
            sandboxUrl={sandboxUrl}
            sandboxId={sandboxUuid || null}
            onBack={() => { setView('type-select'); setSelectedType(null); }}
            onCreated={onCreated}
          />
        )}

        {view === 'slack-wizard' && (
          <SlackWizard
            isDark={isDark}
            theme={theme}
            fg={fg}
            muted={muted}
            inputBg={inputBg}
            borderColor={borderColor}
            sandboxUrl={sandboxUrl}
            sandboxId={sandboxUuid || null}
            onBack={() => { setView('type-select'); setSelectedType(null); }}
            onCreated={onCreated}
          />
        )}

        {view === 'generic-config' && (
          <>
            <Pressable onPress={() => { setView('type-select'); setSelectedType(null); setChannelName(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 }}>
              <Ionicons name="chevron-back" size={16} color={muted} />
              <Text style={{ fontSize: 13, fontFamily: 'Roobert', color: muted }}>Back</Text>
            </Pressable>
            <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>Channel Name</Text>
            <BottomSheetTextInput
              value={channelName}
              onChangeText={setChannelName}
              placeholder={`e.g. My ${selectedType ? getChannelTypeLabel(selectedType) : ''} Bot`}
              placeholderTextColor={isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.3)'}
              autoFocus
              style={{ backgroundColor: inputBg, borderWidth: 1, borderColor, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, fontFamily: 'Roobert', color: fg, marginBottom: 20 }}
            />
            <Pressable
              onPress={handleCreate}
              disabled={!channelName.trim() || isCreating}
              style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: !channelName.trim() ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : theme.primary }}
            >
              {isCreating ? (
                <ActivityIndicator size="small" color={theme.primaryForeground} />
              ) : (
                <Text style={{ fontSize: 16, fontFamily: 'Roobert-Medium', color: !channelName.trim() ? muted : theme.primaryForeground }}>Create Channel</Text>
              )}
            </Pressable>
          </>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

// ─── Telegram Setup Wizard (2 steps) ─────────────────────────────────────────

function TelegramWizard({
  isDark, theme, fg, muted, inputBg, borderColor,
  sandboxUrl, sandboxId, onBack, onCreated,
}: {
  isDark: boolean;
  theme: ReturnType<typeof useThemeColors>;
  fg: string; muted: string; inputBg: string; borderColor: string;
  sandboxUrl?: string;
  sandboxId: string | null;
  onBack: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [botToken, setBotToken] = useState('');
  const [botUsername, setBotUsername] = useState('');
  const [botVerified, setBotVerified] = useState(false);
  const [publicUrl, setPublicUrl] = useState('');

  const verifyMutation = useTelegramVerifyToken();
  const connectMutation = useTelegramConnect();

  const webhookUrl = publicUrl.trim() ? `${publicUrl.replace(/\/$/, '')}/webhooks/telegram` : null;

  const handleVerify = async () => {
    if (!botToken.trim()) return;
    try {
      const result = await verifyMutation.mutateAsync({ botToken: botToken.trim() });
      if (!result.valid) {
        Alert.alert('Invalid Token', result.error || 'Could not verify token');
        return;
      }
      setBotUsername(result.bot?.username || '');
      setBotVerified(true);
      setStep(2);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to verify token');
    }
  };

  const handleConnect = async () => {
    if (!publicUrl.trim() || !sandboxUrl) return;
    try {
      await connectMutation.mutateAsync({
        sandboxUrl,
        sandboxId,
        botToken: botToken.trim(),
        publicUrl: publicUrl.trim(),
        botUsername: botUsername || undefined,
      });
      onCreated();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to connect bot');
    }
  };

  return (
    <>
      {/* Step Indicator */}
      <StepIndicator steps={['Bot Token', 'Webhook URL']} current={step} theme={theme} fg={fg} muted={muted} />

      {step === 1 && (
        <>
          {/* Instructions */}
          <View style={{ borderRadius: 14, backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', padding: 14, marginBottom: 16 }}>
            <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: fg, marginBottom: 8 }}>Create a Telegram bot:</Text>
            <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: muted, lineHeight: 20 }}>
              {'1. Open Telegram and message @BotFather\n2. Send /newbot and follow the prompts\n3. Copy the bot token and paste it below'}
            </Text>
            <Pressable onPress={() => Linking.openURL('https://t.me/BotFather')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}>
              <Text style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: theme.primary }}>Open @BotFather</Text>
              <ExternalLink size={12} color={theme.primary} />
            </Pressable>
          </View>

          <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>Bot Token</Text>
          <BottomSheetTextInput
            value={botToken}
            onChangeText={(t) => { setBotToken(t); setBotVerified(false); }}
            placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
            placeholderTextColor={isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.3)'}
            secureTextEntry
            textContentType="none"
            autoComplete="off"
            style={{ backgroundColor: inputBg, borderWidth: 1, borderColor, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 14, fontFamily: 'Roobert', color: fg, marginBottom: 16 }}
          />

          {botVerified && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: 'rgba(52,211,153,0.08)', marginBottom: 16 }}>
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(52,211,153,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                <Check size={12} color="#34d399" />
              </View>
              <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: '#34d399' }}>Verified: @{botUsername}</Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={onBack} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor }}>
              <ArrowLeft size={16} color={fg} />
              <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: fg }}>Back</Text>
            </Pressable>
            <Pressable
              onPress={handleVerify}
              disabled={!botToken.trim() || verifyMutation.isPending}
              style={{ flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 14, backgroundColor: !botToken.trim() ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : theme.primary }}
            >
              {verifyMutation.isPending ? (
                <ActivityIndicator size="small" color={theme.primaryForeground} />
              ) : (
                <>
                  <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: !botToken.trim() ? muted : theme.primaryForeground }}>Verify & Next</Text>
                  <ArrowRight size={16} color={!botToken.trim() ? muted : theme.primaryForeground} />
                </>
              )}
            </Pressable>
          </View>
        </>
      )}

      {step === 2 && (
        <>
          <Text style={{ fontSize: 13, fontFamily: 'Roobert', color: muted, marginBottom: 12 }}>
            Enter the public URL where Telegram will send webhook events. This should point to kortix-api (port 8008).
          </Text>

          <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>Public URL</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: inputBg, borderWidth: 1, borderColor, borderRadius: 14, paddingHorizontal: 12, marginBottom: 4 }}>
            <Globe size={16} color={muted} />
            <BottomSheetTextInput
              value={publicUrl}
              onChangeText={setPublicUrl}
              placeholder="https://yourdomain.com"
              placeholderTextColor={isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.3)'}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ flex: 1, marginLeft: 8, paddingVertical: 14, fontSize: 14, fontFamily: 'Roobert', color: fg }}
            />
          </View>
          <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: muted, marginBottom: 16 }}>
            Webhook: {webhookUrl || '...'}
          </Text>

          {/* Security note */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', marginBottom: 16 }}>
            <Shield size={14} color="#34d399" style={{ marginTop: 2 }} />
            <Text style={{ flex: 1, fontSize: 11, fontFamily: 'Roobert', color: muted, lineHeight: 16 }}>
              A random secret token is generated and shared with Telegram. Only requests with the matching header are accepted.
            </Text>
          </View>

          {/* Verified badge */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: 'rgba(52,211,153,0.08)', marginBottom: 16 }}>
            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(52,211,153,0.15)', alignItems: 'center', justifyContent: 'center' }}>
              <Check size={12} color="#34d399" />
            </View>
            <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: fg }}>@{botUsername}</Text>
            <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: muted }}>verified</Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => setStep(1)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor }}>
              <ArrowLeft size={16} color={fg} />
              <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: fg }}>Back</Text>
            </Pressable>
            <Pressable
              onPress={handleConnect}
              disabled={!publicUrl.trim() || connectMutation.isPending}
              style={{ flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 14, backgroundColor: !publicUrl.trim() ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : theme.primary }}
            >
              {connectMutation.isPending ? (
                <ActivityIndicator size="small" color={theme.primaryForeground} />
              ) : (
                <>
                  <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: !publicUrl.trim() ? muted : theme.primaryForeground }}>Connect Bot</Text>
                  <ArrowRight size={16} color={!publicUrl.trim() ? muted : theme.primaryForeground} />
                </>
              )}
            </Pressable>
          </View>
        </>
      )}
    </>
  );
}

// ─── Slack Setup Wizard (3 steps) ────────────────────────────────────────────

const BOT_NAMES = [
  'Atlas', 'Nova', 'Sage', 'Echo', 'Bolt', 'Iris', 'Dash', 'Cleo',
  'Finn', 'Luna', 'Juno', 'Axel', 'Niko', 'Zara', 'Milo', 'Ruby',
  'Hugo', 'Aria', 'Leo', 'Ivy', 'Rex', 'Mae', 'Kai', 'Pia',
];

function randomBotName(): string {
  return `Kortix ${BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]}`;
}

function SlackWizard({
  isDark, theme, fg, muted, inputBg, borderColor,
  sandboxUrl, sandboxId, onBack, onCreated,
}: {
  isDark: boolean;
  theme: ReturnType<typeof useThemeColors>;
  fg: string; muted: string; inputBg: string; borderColor: string;
  sandboxUrl?: string;
  sandboxId: string | null;
  onBack: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Configure
  const [botName, setBotName] = useState(() => randomBotName());
  const [agentName, setAgentName] = useState('kortix');
  const [selectedModelIdx, setSelectedModelIdx] = useState(0);

  // Step 2: Manifest
  const [manifestJson, setManifestJson] = useState('');
  const [copied, setCopied] = useState(false);

  // Step 3: Credentials
  const [botToken, setBotToken] = useState('');
  const [signingSecret, setSigningSecret] = useState('');

  const generateManifest = useSlackGenerateManifest();
  const connectMutation = useSlackConnect();

  // Load agents & models
  const { data: agents = [] } = useOpenCodeAgents(sandboxUrl);
  const { data: providers } = useOpenCodeProviders(sandboxUrl);
  const models = useMemo(() => (providers ? flattenModels(providers) : []), [providers]);
  const filteredModels = useMemo(() => filterToLatestModels(models), [models]);

  const handleGenerateManifest = async () => {
    if (!sandboxUrl) return;
    try {
      const result = await generateManifest.mutateAsync({ publicUrl: '', botName: botName.trim() || undefined });
      setManifestJson(result.manifestJson);
      setStep(2);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to generate manifest');
    }
  };

  const handleCopyManifest = async () => {
    await Clipboard.setStringAsync(manifestJson);
    setCopied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConnect = async () => {
    if (!botToken.trim() || !signingSecret.trim() || !sandboxUrl) return;
    if (!botToken.startsWith('xoxb-')) {
      Alert.alert('Invalid Token', 'Bot token must start with xoxb-');
      return;
    }
    if (signingSecret.trim().length < 10) {
      Alert.alert('Invalid Secret', 'Signing secret must be at least 10 characters');
      return;
    }
    const selModel = filteredModels[selectedModelIdx];
    const modelStr = selModel ? `${selModel.providerID}/${selModel.modelID}` : undefined;
    try {
      await connectMutation.mutateAsync({
        sandboxUrl,
        sandboxId,
        botToken: botToken.trim(),
        signingSecret: signingSecret.trim(),
        publicUrl: '',
        name: botName.trim() || undefined,
        defaultAgent: agentName || undefined,
        defaultModel: modelStr,
      });
      onCreated();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to connect Slack');
    }
  };

  const inputStyle = { backgroundColor: inputBg, borderWidth: 1, borderColor, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 14, fontFamily: 'Roobert', color: fg };

  return (
    <>
      <StepIndicator steps={['Configure', 'Create App', 'Connect']} current={step} theme={theme} fg={fg} muted={muted} />

      {/* ─── Step 1: Configure ─── */}
      {step === 1 && (
        <>
          {/* Bot Name */}
          <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>Bot Name</Text>
          <BottomSheetTextInput
            value={botName}
            onChangeText={setBotName}
            placeholder="Kortix Agent"
            placeholderTextColor={isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.3)'}
            style={{ ...inputStyle, marginBottom: 4 }}
          />
          <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: muted, marginBottom: 16 }}>Display name in Slack.</Text>

          {/* Agent */}
          <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>Agent</Text>
          <View style={{ borderRadius: 14, borderWidth: 1, borderColor, backgroundColor: inputBg, marginBottom: 16, overflow: 'hidden' }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 8, gap: 6 }}>
              {agents.map((agent) => {
                const active = agentName === agent.name;
                return (
                  <Pressable
                    key={agent.name}
                    onPress={() => { setAgentName(agent.name); Haptics.selectionAsync(); }}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
                      backgroundColor: active ? theme.primary : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
                    }}
                  >
                    <Text style={{ fontSize: 13, fontFamily: active ? 'Roobert-Medium' : 'Roobert', color: active ? theme.primaryForeground : muted }}>
                      {agent.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* Model */}
          <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>Model</Text>
          <View style={{ borderRadius: 14, borderWidth: 1, borderColor, backgroundColor: inputBg, marginBottom: 20, overflow: 'hidden' }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 8, gap: 6 }}>
              {filteredModels.map((m, i) => {
                const active = selectedModelIdx === i;
                return (
                  <Pressable
                    key={`${m.providerID}:${m.modelID}`}
                    onPress={() => { setSelectedModelIdx(i); Haptics.selectionAsync(); }}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
                      backgroundColor: active ? theme.primary : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
                    }}
                  >
                    <Text style={{ fontSize: 13, fontFamily: active ? 'Roobert-Medium' : 'Roobert', color: active ? theme.primaryForeground : muted }} numberOfLines={1}>
                      {m.modelName}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* Generate Manifest */}
          <Pressable
            onPress={handleGenerateManifest}
            disabled={generateManifest.isPending}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 14, backgroundColor: theme.primary, alignSelf: 'flex-end', paddingHorizontal: 20 }}
          >
            {generateManifest.isPending ? (
              <ActivityIndicator size="small" color={theme.primaryForeground} />
            ) : (
              <>
                <ArrowRight size={16} color={theme.primaryForeground} />
                <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: theme.primaryForeground }}>Generate Manifest</Text>
              </>
            )}
          </Pressable>
        </>
      )}

      {/* ─── Step 2: Create App ─── */}
      {step === 2 && (
        <>
          <View style={{ borderRadius: 14, backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', padding: 14, marginBottom: 16 }}>
            <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: fg, marginBottom: 8 }}>Create your Slack app:</Text>
            <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: muted, lineHeight: 20 }}>
              {'1. Go to api.slack.com/apps → Create New App → From an app manifest\n2. Select your workspace, paste the manifest below\n3. After creating, Install to Workspace from OAuth & Permissions'}
            </Text>
            <Pressable onPress={() => Linking.openURL('https://api.slack.com/apps')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}>
              <Text style={{ fontSize: 12, fontFamily: 'Roobert-Medium', color: theme.primary }}>Open Slack API</Text>
              <ExternalLink size={12} color={theme.primary} />
            </Pressable>
          </View>

          <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>App Manifest (JSON)</Text>
          <View style={{ borderRadius: 12, backgroundColor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.04)', padding: 12, marginBottom: 8, maxHeight: 120 }}>
            <ScrollView horizontal={false} showsVerticalScrollIndicator>
              <Text style={{ fontSize: 11, fontFamily: 'monospace', color: muted }} selectable>{manifestJson}</Text>
            </ScrollView>
          </View>
          <Pressable onPress={handleCopyManifest} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', marginBottom: 16 }}>
            {copied ? <Check size={14} color="#34d399" /> : <Copy size={14} color={fg} />}
            <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: copied ? '#34d399' : fg }}>{copied ? 'Copied!' : 'Copy Manifest'}</Text>
          </Pressable>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => setStep(1)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor }}>
              <ArrowLeft size={16} color={fg} />
              <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: fg }}>Back</Text>
            </Pressable>
            <Pressable onPress={() => setStep(3)} style={{ flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 14, backgroundColor: theme.primary }}>
              <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: theme.primaryForeground }}>Next</Text>
              <ArrowRight size={16} color={theme.primaryForeground} />
            </Pressable>
          </View>
        </>
      )}

      {/* ─── Step 3: Connect ─── */}
      {step === 3 && (
        <>
          <View style={{ borderRadius: 14, backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', padding: 14, marginBottom: 16 }}>
            <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: muted, lineHeight: 18 }}>
              Go to your app on api.slack.com → OAuth & Permissions to find the Bot Token, and Basic Information → Signing Secret.
            </Text>
          </View>

          <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>Bot User OAuth Token</Text>
          <BottomSheetTextInput
            value={botToken}
            onChangeText={setBotToken}
            placeholder="xoxb-..."
            placeholderTextColor={isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.3)'}
            secureTextEntry
            textContentType="none"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect={false}
            style={{ ...inputStyle, marginBottom: 12 }}
          />

          <Text style={{ fontSize: 13, fontFamily: 'Roobert-Medium', color: muted, marginBottom: 6 }}>Signing Secret</Text>
          <BottomSheetTextInput
            value={signingSecret}
            onChangeText={setSigningSecret}
            placeholder="Enter signing secret"
            placeholderTextColor={isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.3)'}
            secureTextEntry
            textContentType="none"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect={false}
            style={{ ...inputStyle, marginBottom: 16 }}
          />

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => setStep(2)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor }}>
              <ArrowLeft size={16} color={fg} />
              <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: fg }}>Back</Text>
            </Pressable>
            <Pressable
              onPress={handleConnect}
              disabled={!botToken.trim() || !signingSecret.trim() || connectMutation.isPending}
              style={{
                flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 14,
                backgroundColor: (!botToken.trim() || !signingSecret.trim()) ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : theme.primary,
              }}
            >
              {connectMutation.isPending ? (
                <ActivityIndicator size="small" color={theme.primaryForeground} />
              ) : (
                <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: (!botToken.trim() || !signingSecret.trim()) ? muted : theme.primaryForeground }}>Connect Bot</Text>
              )}
            </Pressable>
          </View>
        </>
      )}
    </>
  );
}

// ─── Step Indicator ──────────────────────────────────────────────────────────

function StepIndicator({
  steps, current, theme, fg, muted,
}: {
  steps: string[];
  current: number;
  theme: ReturnType<typeof useThemeColors>;
  fg: string;
  muted: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 0, marginBottom: 20 }}>
      {steps.map((label, i) => {
        const stepNum = i + 1;
        const isActive = current === stepNum;
        const isComplete = current > stepNum;
        return (
          <React.Fragment key={label}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{
                width: 24, height: 24, borderRadius: 12,
                backgroundColor: isActive ? theme.primary : isComplete ? `${theme.primary}33` : 'rgba(128,128,128,0.15)',
                alignItems: 'center', justifyContent: 'center',
              }}>
                {isComplete ? (
                  <Check size={12} color={theme.primary} />
                ) : (
                  <Text style={{ fontSize: 11, fontFamily: 'Roobert-Medium', color: isActive ? theme.primaryForeground : muted }}>{stepNum}</Text>
                )}
              </View>
              <Text style={{ fontSize: 11, fontFamily: 'Roobert-Medium', color: isActive ? fg : muted }}>{label}</Text>
            </View>
            {i < steps.length - 1 && (
              <View style={{ width: 20, height: 1, backgroundColor: isComplete ? `${theme.primary}66` : 'rgba(128,128,128,0.15)', marginHorizontal: 6 }} />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}
