'use client';

import * as React from 'react';
import { Check, Monitor, Sun, Moon, Palette, ImageIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { FilterBar, FilterBarItem } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { transitionFromElement } from '@/lib/view-transition';
import { useUserPreferencesStore } from '@/stores/user-preferences-store';
import { THEMES, DEFAULT_THEME_ID, type KortixTheme } from '@/lib/themes';
import { WALLPAPERS, DEFAULT_WALLPAPER_ID, type Wallpaper } from '@/lib/wallpapers';

function ThemeItem({
  theme,
  isActive,
  onSelect,
}: {
  theme: KortixTheme;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onSelect}
      className={cn(
        'flex items-center gap-3 w-full h-auto px-3 py-2.5 rounded-lg text-left justify-start',
        isActive && 'bg-accent'
      )}
    >
      <span
        className="size-5 rounded-full shrink-0 ring-1 ring-border/30"
        style={{ backgroundColor: theme.accentColor }}
      />
      <span className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium text-foreground truncate">
          {theme.name}
        </span>
        {theme.id === DEFAULT_THEME_ID && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
            Default
          </span>
        )}
      </span>
      {isActive && (
        <Check className="size-4 text-primary ml-auto shrink-0" />
      )}
    </Button>
  );
}

function WallpaperCard({
  wallpaper,
  isActive,
  onSelect,
}: {
  wallpaper: Wallpaper;
  isActive: boolean;
  onSelect: () => void;
}) {
  const { type } = wallpaper;

  // Theme-aware preview backgrounds:
  // Light mode → light bg with dark assets, Dark mode → dark bg with light assets
  // Mirrors exactly how each wallpaper renders on the actual page.
  const renderPreview = () => {
    switch (type) {
      case 'svg':
        // Brandmark SVG has white strokes — needs dark bg to see them.
        // In light mode, the actual wallpaper inverts them to black on white bg.
        return (
          <div className="absolute inset-0 bg-zinc-100 dark:bg-zinc-950 flex items-center justify-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={wallpaper.thumbnailUrl}
              alt={wallpaper.name}
              className="w-[200%] h-auto object-contain select-none invert dark:invert-0"
              draggable={false}
            />
          </div>
        );
      case 'symbol':
        // Symbol SVG has black fill — visible on light, needs invert on dark.
        return (
          <div className="absolute inset-0 bg-zinc-100 dark:bg-zinc-950 flex items-center justify-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={wallpaper.thumbnailUrl}
              alt={wallpaper.name}
              className="w-[12%] h-auto object-contain select-none opacity-[0.12] dark:opacity-[0.15] dark:invert"
              draggable={false}
            />
          </div>
        );
      case 'aurora':
        // Logomark SVG is white fill — invert to black on light, keep white on dark.
        // Radial glow hints at the animated arcs on the edges.
        return (
          <div className="absolute inset-0 bg-zinc-100 dark:bg-zinc-950 overflow-hidden">
            <div
              className="absolute inset-0 opacity-30 dark:opacity-50"
              style={{
                background:
                  'radial-gradient(ellipse at 10% 30%, rgba(120,120,120,0.2) 0%, transparent 50%), radial-gradient(ellipse at 90% 40%, rgba(100,100,100,0.16) 0%, transparent 45%)',
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={wallpaper.thumbnailUrl}
                alt={wallpaper.name}
                className="w-[28%] h-auto object-contain select-none invert dark:invert-0"
                draggable={false}
              />
            </div>
          </div>
        );
      default:
        return (
          <>
            <div className="absolute inset-0 dark:hidden">
              <Image
                src={wallpaper.lightUrl!}
                alt={wallpaper.name}
                fill
                className="object-cover"
                unoptimized
                sizes="160px"
              />
            </div>
            <div className="absolute inset-0 hidden dark:block">
              <Image
                src={wallpaper.darkUrl!}
                alt={wallpaper.name}
                fill
                className="object-cover"
                unoptimized
                sizes="160px"
              />
            </div>
          </>
        );
    }
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group relative cursor-pointer rounded-lg overflow-hidden transition-colors duration-200',
        'ring-2 ring-offset-1 ring-offset-background',
        isActive
          ? 'ring-primary'
          : 'ring-transparent hover:ring-border/50'
      )}
    >
      <div className="relative w-full aspect-video bg-muted">
        {renderPreview()}
        {/* Hover overlay */}
        <div
          className={cn(
            'absolute inset-0 transition-opacity duration-200',
            isActive ? 'bg-black/10' : 'bg-black/0 group-hover:bg-black/10'
          )}
        />
        {/* Check badge */}
        {isActive && (
          <div className="absolute top-1 right-1 size-4 rounded-full bg-primary flex items-center justify-center shadow-md">
            <Check className="size-2.5 text-primary-foreground" />
          </div>
        )}
      </div>
      <div className="px-1.5 py-1">
        <span className="text-[11px] font-medium text-foreground flex items-center gap-1">
          {wallpaper.name}
          {wallpaper.id === DEFAULT_WALLPAPER_ID && (
            <span className="text-[0.5625rem] font-medium px-1 py-px rounded-full bg-muted text-muted-foreground">
              Default
            </span>
          )}
         </span>
       </div>
     </button>
   );
}

const BASE_MODES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

export function AppearanceTab() {
  const { theme: baseMode, setTheme: setBaseMode } = useTheme();
  const themeId = useUserPreferencesStore((s) => s.preferences.themeId);
  const setThemeId = useUserPreferencesStore((s) => s.setThemeId);
  const wallpaperId = useUserPreferencesStore(
    (s) => s.preferences.wallpaperId ?? DEFAULT_WALLPAPER_ID
  );
  const setWallpaperId = useUserPreferencesStore((s) => s.setWallpaperId);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!THEMES.some((theme) => theme.id === themeId)) {
      setThemeId(DEFAULT_THEME_ID);
    }
  }, [themeId, setThemeId]);

  const hasCustomSettings =
    themeId !== DEFAULT_THEME_ID || wallpaperId !== DEFAULT_WALLPAPER_ID;

  return (
    <div className="p-4 sm:p-6 pb-12 sm:pb-6 space-y-5 sm:space-y-6 min-w-0 max-w-full overflow-x-hidden">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Palette className="size-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Appearance</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Choose a theme, color mode, and wallpaper.
        </p>
      </div>

      <div className="space-y-5 sm:space-y-6">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-2 block">
            Color Mode
          </label>
          <FilterBar>
            {BASE_MODES.map((mode) => {
              const Icon = mode.icon;
              const isActive = mounted && baseMode === mode.value;
              return (
                <FilterBarItem
                  key={mode.value}
                  value={mode.value}
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                    if (mode.value === baseMode) return;
                    transitionFromElement(e.currentTarget as HTMLElement, () => setBaseMode(mode.value));
                  }}
                  data-state={isActive ? 'active' : 'inactive'}
                >
                  <Icon className="size-3.5" />
                  {mode.label}
                </FilterBarItem>
              );
            })}
          </FilterBar>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <ImageIcon className="size-4 text-muted-foreground" />
            <label className="text-xs font-medium text-muted-foreground">
              Wallpaper
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {WALLPAPERS.map((wp) => (
              <WallpaperCard
                key={wp.id}
                wallpaper={wp}
                isActive={wallpaperId === wp.id}
                onSelect={() => setWallpaperId(wp.id)}
              />
            ))}
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center gap-2 mb-2">
            <Palette className="size-4 text-muted-foreground" />
            <label className="text-xs font-medium text-muted-foreground">
              Theme Palette
            </label>
          </div>

          <div className="flex flex-col gap-0.5">
            {THEMES.map((theme) => (
              <ThemeItem
                key={theme.id}
                theme={theme}
                isActive={themeId === theme.id}
                onSelect={() => setThemeId(theme.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {hasCustomSettings && (
        <div className="pt-3 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => {
              setThemeId(DEFAULT_THEME_ID);
              setWallpaperId(DEFAULT_WALLPAPER_ID);
            }}
          >
            Reset to defaults
          </Button>
        </div>
      )}
    </div>
  );
}
