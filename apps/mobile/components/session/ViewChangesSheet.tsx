/**
 * ViewChangesSheet — Full-screen bottom sheet showing all file changes in a session.
 * Ported from web's SessionDiffViewer, adapted for mobile.
 */
import React, { forwardRef, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Platform,
  LayoutAnimation,
  ScrollView,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { useColorScheme } from 'nativewind';
import {
  X,
  ChevronRight,
  ChevronDown,
  FilePlus2,
  FileX2,
  FileEdit,
  FileCode2,
} from 'lucide-react-native';

import { useSyncStore } from '@/lib/opencode/sync-store';
import { extractDiffsFromMessages, type FileDiffData } from '@/lib/opencode/extract-diffs';
import { generateLineDiff, type DiffLine } from '@/lib/opencode/diff-utils';

// ─── Constants ──────────────────────────────────────────────────────────────

const monoFont = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg',
  'mp3', 'wav', 'ogg', 'mp4', 'mov', 'avi', 'webm',
  'zip', 'tar', 'gz', 'rar', '7z',
  'pdf', 'doc', 'docx', 'xls', 'xlsx',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
]);

function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return BINARY_EXTENSIONS.has(ext);
}

// ─── Colors ─────────────────────────────────────────────────────────────────

const colors = {
  bg: (d: boolean) => (d ? '#121215' : '#FFFFFF'),
  cardBg: (d: boolean) => (d ? '#1a1a1f' : '#F9F9FA'),
  cardBorder: (d: boolean) => (d ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'),
  fg: (d: boolean) => (d ? '#e4e4e7' : '#18181b'),
  muted: (d: boolean) => (d ? '#71717a' : '#a1a1aa'),
  mutedStrong: (d: boolean) => (d ? '#a1a1aa' : '#71717a'),
  divider: (d: boolean) => (d ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'),
  addedBg: (d: boolean) => (d ? 'rgba(34,197,94,0.10)' : 'rgba(34,197,94,0.07)'),
  addedBorder: (d: boolean) => (d ? '#4ade80' : '#22c55e'),
  addedText: (d: boolean) => (d ? '#bbf7d0' : '#15803d'),
  addedSign: (d: boolean) => (d ? '#4ade80' : '#16a34a'),
  removedBg: (d: boolean) => (d ? 'rgba(239,68,68,0.10)' : 'rgba(239,68,68,0.07)'),
  removedBorder: (d: boolean) => (d ? '#f87171' : '#ef4444'),
  removedText: (d: boolean) => (d ? '#fca5a5' : '#b91c1c'),
  removedSign: (d: boolean) => (d ? '#f87171' : '#dc2626'),
  unchangedText: (d: boolean) => (d ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)'),
  emerald: (d: boolean) => (d ? '#34d399' : '#059669'),
  red: (d: boolean) => (d ? '#f87171' : '#dc2626'),
  blue: (d: boolean) => (d ? '#60a5fa' : '#2563eb'),
};

// ─── Props ──────────────────────────────────────────────────────────────────

interface ViewChangesSheetProps {
  sessionId: string | null;
}

// ─── FileDiffCard ───────────────────────────────────────────────────────────

const MAX_DIFF_LINES = 200;

function FileDiffCard({ diff, isDark }: { diff: FileDiffData; isDark: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const binary = isBinaryFile(diff.file);
  const hasDiffContent = !binary && (!!diff.before || !!diff.after);

  // Lazy diff computation — only when expanded
  const lineDiff = useMemo<DiffLine[] | null>(() => {
    if (!expanded || !hasDiffContent) return null;
    return generateLineDiff(diff.before, diff.after);
  }, [expanded, hasDiffContent, diff.before, diff.after]);

  const filename = diff.file.split('/').pop() || diff.file;
  const directory = diff.file.includes('/')
    ? diff.file.substring(0, diff.file.lastIndexOf('/'))
    : '';

  const handlePress = useCallback(() => {
    if (!hasDiffContent) return;
    LayoutAnimation.configureNext({
      duration: 200,
      create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    });
    setExpanded(prev => !prev);
  }, [hasDiffContent]);

  // Status config
  const statusConfig = useMemo(() => {
    switch (diff.status) {
      case 'added':
        return {
          icon: FilePlus2,
          label: 'Added',
          color: colors.emerald(isDark),
          badgeBg: isDark ? 'rgba(52,211,153,0.12)' : 'rgba(5,150,105,0.08)',
        };
      case 'deleted':
        return {
          icon: FileX2,
          label: 'Deleted',
          color: colors.red(isDark),
          badgeBg: isDark ? 'rgba(248,113,113,0.12)' : 'rgba(220,38,38,0.08)',
        };
      default:
        return {
          icon: FileEdit,
          label: 'Modified',
          color: colors.blue(isDark),
          badgeBg: isDark ? 'rgba(96,165,250,0.12)' : 'rgba(37,99,235,0.08)',
        };
    }
  }, [diff.status, isDark]);

  const StatusIcon = statusConfig.icon;
  const fs = 10.5;
  const lh = 16;

  return (
    <View
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.cardBorder(isDark),
        backgroundColor: colors.cardBg(isDark),
        marginBottom: 8,
        overflow: 'hidden',
      }}
    >
      {/* File header */}
      <TouchableOpacity
        activeOpacity={hasDiffContent ? 0.7 : 1}
        onPress={handlePress}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 6,
        }}
      >
        {/* Chevron */}
        {hasDiffContent ? (
          expanded ? (
            <ChevronDown size={12} color={colors.muted(isDark)} />
          ) : (
            <ChevronRight size={12} color={colors.muted(isDark)} />
          )
        ) : (
          <View style={{ width: 12 }} />
        )}

        {/* Status icon */}
        <StatusIcon size={14} color={statusConfig.color} />

        {/* Filename + directory */}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
          <Text
            numberOfLines={1}
            style={{
              fontSize: 12,
              fontFamily: 'Roobert-Medium',
              color: colors.fg(isDark),
            }}
          >
            {filename}
          </Text>
          {!!directory && (
            <Text
              numberOfLines={1}
              style={{
                fontSize: 10,
                fontFamily: monoFont,
                color: colors.muted(isDark),
                opacity: 0.6,
                flexShrink: 1,
              }}
            >
              {directory}
            </Text>
          )}
        </View>

        {/* Status badge */}
        <View
          style={{
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 4,
            backgroundColor: statusConfig.badgeBg,
          }}
        >
          <Text style={{ fontSize: 10, fontFamily: 'Roobert-Medium', color: statusConfig.color }}>
            {statusConfig.label}
          </Text>
        </View>

        {/* +/- counts */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {diff.additions > 0 && (
            <Text style={{ fontSize: 10, fontFamily: monoFont, color: colors.emerald(isDark) }}>
              +{diff.additions}
            </Text>
          )}
          {diff.deletions > 0 && (
            <Text style={{ fontSize: 10, fontFamily: monoFont, color: colors.red(isDark) }}>
              -{diff.deletions}
            </Text>
          )}
        </View>
      </TouchableOpacity>

      {/* Expanded diff content */}
      {expanded && lineDiff && (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: colors.divider(isDark),
          }}
        >
          <ScrollView
            style={{ maxHeight: 350 }}
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            {lineDiff.slice(0, MAX_DIFF_LINES).map((line, i) => {
              const isRemoved = line.type === 'removed';
              const isAdded = line.type === 'added';

              return (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row',
                    backgroundColor: isRemoved
                      ? colors.removedBg(isDark)
                      : isAdded
                      ? colors.addedBg(isDark)
                      : 'transparent',
                    borderLeftWidth: 2,
                    borderLeftColor: isRemoved
                      ? colors.removedBorder(isDark)
                      : isAdded
                      ? colors.addedBorder(isDark)
                      : 'transparent',
                  }}
                >
                  {/* +/- indicator */}
                  <View style={{ width: 20, alignItems: 'center', justifyContent: 'center' }}>
                    {isRemoved && (
                      <Text style={{ fontSize: fs, fontFamily: monoFont, color: colors.removedSign(isDark), fontWeight: '600' }}>
                        −
                      </Text>
                    )}
                    {isAdded && (
                      <Text style={{ fontSize: fs, fontFamily: monoFont, color: colors.addedSign(isDark), fontWeight: '600' }}>
                        +
                      </Text>
                    )}
                  </View>
                  {/* Code content */}
                  <Text
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      fontSize: fs,
                      fontFamily: monoFont,
                      lineHeight: lh,
                      paddingVertical: 1,
                      paddingRight: 12,
                      color: isRemoved
                        ? colors.removedText(isDark)
                        : isAdded
                        ? colors.addedText(isDark)
                        : colors.unchangedText(isDark),
                    }}
                  >
                    {line.text}
                  </Text>
                </View>
              );
            })}
            {lineDiff.length > MAX_DIFF_LINES && (
              <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
                <Text style={{ fontSize: 10, fontFamily: monoFont, color: colors.muted(isDark) }}>
                  ... {lineDiff.length - MAX_DIFF_LINES} more lines
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      )}

      {/* Binary file notice */}
      {binary && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
          <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: colors.muted(isDark), fontStyle: 'italic' }}>
            Binary file
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Summary header ─────────────────────────────────────────────────────────

function SummaryHeader({
  diffs,
  isDark,
  onClose,
}: {
  diffs: FileDiffData[];
  isDark: boolean;
  onClose: () => void;
}) {
  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    let added = 0;
    let deleted = 0;
    let modified = 0;
    for (const d of diffs) {
      additions += d.additions;
      deletions += d.deletions;
      if (d.status === 'added') added++;
      else if (d.status === 'deleted') deleted++;
      else modified++;
    }
    return { additions, deletions, added, deleted, modified };
  }, [diffs]);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider(isDark),
      }}
    >
      {/* Left: file count */}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontFamily: 'Roobert-Medium', color: colors.fg(isDark) }}>
          {diffs.length} {diffs.length === 1 ? 'file' : 'files'} changed
        </Text>
      </View>

      {/* Stats */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 12 }}>
        {totals.added > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <FilePlus2 size={11} color={colors.emerald(isDark)} />
            <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: colors.emerald(isDark) }}>
              {totals.added}
            </Text>
          </View>
        )}
        {totals.modified > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <FileEdit size={11} color={colors.blue(isDark)} />
            <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: colors.blue(isDark) }}>
              {totals.modified}
            </Text>
          </View>
        )}
        {totals.deleted > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <FileX2 size={11} color={colors.red(isDark)} />
            <Text style={{ fontSize: 11, fontFamily: 'Roobert', color: colors.red(isDark) }}>
              {totals.deleted}
            </Text>
          </View>
        )}

        <Text style={{ fontSize: 10, color: colors.muted(isDark), opacity: 0.4 }}>|</Text>

        {totals.additions > 0 && (
          <Text style={{ fontSize: 11, fontFamily: monoFont, color: colors.emerald(isDark) }}>
            +{totals.additions}
          </Text>
        )}
        {totals.deletions > 0 && (
          <Text style={{ fontSize: 11, fontFamily: monoFont, color: colors.red(isDark) }}>
            -{totals.deletions}
          </Text>
        )}
      </View>

      {/* Close button */}
      <TouchableOpacity
        onPress={onClose}
        hitSlop={12}
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <X size={14} color={colors.muted(isDark)} />
      </TouchableOpacity>
    </View>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────

function EmptyState({ isDark }: { isDark: boolean }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 12,
        }}
      >
        <FileCode2 size={24} color={colors.muted(isDark)} />
      </View>
      <Text style={{ fontSize: 14, fontFamily: 'Roobert-Medium', color: colors.mutedStrong(isDark), marginBottom: 4 }}>
        No changes yet
      </Text>
      <Text style={{ fontSize: 12, fontFamily: 'Roobert', color: colors.muted(isDark) }}>
        File changes will appear here
      </Text>
    </View>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export const ViewChangesSheet = forwardRef<BottomSheetModal, ViewChangesSheetProps>(
  function ViewChangesSheet({ sessionId }, ref) {
    const { colorScheme } = useColorScheme();
    const isDark = colorScheme === 'dark';

    // Read messages for this session from sync store
    const messages = useSyncStore((s: any) => sessionId ? s.messages[sessionId] : undefined);

    // Extract diffs from all messages
    const diffs = useMemo(() => {
      if (!sessionId || !messages || !Array.isArray(messages)) return [];
      return extractDiffsFromMessages(messages as any);
    }, [sessionId, messages]);

    const renderBackdrop = useMemo(
      () => (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.35} />
      ),
      [],
    );

    const handleClose = useCallback(() => {
      (ref as React.RefObject<BottomSheetModal>)?.current?.dismiss();
    }, [ref]);

    return (
      <BottomSheetModal
        ref={ref}
        index={0}
        snapPoints={['92%']}
        enableDynamicSizing={false}
        enableOverDrag={false}
        enablePanDownToClose
        handleIndicatorStyle={{
          backgroundColor: isDark ? '#3F3F46' : '#D4D4D8',
          width: 36,
          height: 5,
          borderRadius: 3,
        }}
        backgroundStyle={{
          backgroundColor: colors.bg(isDark),
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
        }}
        backdropComponent={renderBackdrop}
      >
        {/* Header */}
        <SummaryHeader diffs={diffs} isDark={isDark} onClose={handleClose} />

        {/* File list */}
        {diffs.length === 0 ? (
          <EmptyState isDark={isDark} />
        ) : (
          <BottomSheetScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          >
            {diffs.map((diff) => (
              <FileDiffCard key={diff.file} diff={diff} isDark={isDark} />
            ))}
          </BottomSheetScrollView>
        )}
      </BottomSheetModal>
    );
  },
);
