'use client';

import { useMemo, useState } from 'react';
import {
	Check,
	Download,
	FileText,
	Loader2,
	Package,
	Search,
	Sparkles,
	X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FilterBar, FilterBarItem } from '@/components/ui/tabs';
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkspaceItemCard } from '@/components/ui/workspace-item-card';
import { PageHeader } from '@/components/ui/page-header';
import { getClient } from '@/lib/opencode-sdk';
import { cn } from '@/lib/utils';
import { getPtyWebSocketUrl } from '@/hooks/opencode/use-opencode-pty';

import {
	type RegistryComponent,
	type RegistryComponentBundle,
	useInstalledSkillNames,
	useMarketplaceComponent,
	useMarketplaceSkills,
} from '../hooks/use-marketplace';
import { useMarketplaceStore } from '../store/marketplace-store';
import { skillsKeys } from '../hooks/use-skills';

type FilterKey = 'all' | 'installed' | 'skills' | 'agents' | 'tools' | 'plugins';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
	{ key: 'all',       label: 'All' },
	{ key: 'installed', label: 'Installed' },
	{ key: 'skills',    label: 'Skills' },
	{ key: 'agents',    label: 'Agents' },
	{ key: 'tools',     label: 'Tools' },
	{ key: 'plugins',   label: 'Plugins' },
];

function kindLabel(type: string): string {
	if (type === 'ocx:skill')  return 'Skill';
	if (type === 'ocx:agent')  return 'Agent';
	if (type === 'ocx:tool')   return 'Tool';
	if (type === 'ocx:plugin') return 'Plugin';
	return type.replace('ocx:', '');
}

// ── PTY install helpers ───────────────────────────────────────────────────────

async function runPtyCommand(command: string): Promise<string> {
	const client = getClient();
	const created = await client.pty.create({
		command: '/bin/sh',
		args: ['-c', command],
		title: '__marketplace-install__',
	});

	if (created.error) {
		const err = created.error as { data?: { message?: string }; message?: string };
		throw new Error(err.data?.message || err.message || 'Failed to create PTY');
	}

	const pty = created.data as { id?: string };
	if (!pty.id) throw new Error('PTY created but no ID returned');

	const connectUrl = await getPtyWebSocketUrl(pty.id);

	return new Promise<string>((resolve, reject) => {
		const ws = new WebSocket(connectUrl);
		const chunks: string[] = [];
		const timeout = setTimeout(() => { ws.close(); reject(new Error('Install timed out')); }, 60_000);
		ws.onmessage = (e) => { if (typeof e.data === 'string') chunks.push(e.data); };
		ws.onclose   = () => { clearTimeout(timeout); resolve(chunks.join('')); };
		ws.onerror   = () => { clearTimeout(timeout); reject(new Error('Unable to read install output')); };
	});
}

async function installComponentWithOcx(componentName: string) {
	const output = await runPtyCommand(
		`cd /workspace && ocx init -q 2>/dev/null && ocx registry add https://kortix-registry-6om.pages.dev --name kortix -q 2>/dev/null; ocx add kortix/${componentName} 2>&1`,
	);
	const normalized = output.toLowerCase();
	const isInstalled = normalized.includes('installed') || normalized.includes('done');
	if (!isInstalled && (normalized.includes('not found') || normalized.includes('failed to') || normalized.includes('registry alias'))) {
		throw new Error(output.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim() || 'Install failed');
	}
	try {
		const client = getClient();
		await client.instance.dispose();
	} catch { /* non-fatal */ }
	return output;
}

function formatPath(path: string) {
	const parts = path.split('/');
	return parts.length > 1 ? parts.slice(1).join('/') : parts[0];
}

// ── Component Detail Modal ────────────────────────────────────────────────────

function ComponentDetailModal({
	component,
	open,
	onOpenChange,
}: {
	component: RegistryComponent | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { data, isLoading, error } = useMarketplaceComponent(open ? component?.name ?? null : null);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const queryClient = useQueryClient();
	const installedSkills = useInstalledSkillNames();
	const { installing, markInstalling, clearInstalling } = useMarketplaceStore();
	const [installError, setInstallError] = useState('');

	const bundle = data as RegistryComponentBundle | undefined;
	const isInstalled = component ? installedSkills.has(component.name.toLowerCase()) : false;
	const isInstalling = component ? installing.includes(component.name) : false;

	const activePath = useMemo(() => {
		if (!bundle) return null;
		if (selectedPath && bundle.files.some((f) => f.path === selectedPath)) return selectedPath;
		return bundle.files[0]?.path ?? null;
	}, [bundle, selectedPath]);

	const activeFile = bundle?.files.find((f) => f.path === activePath) ?? null;

	const handleInstall = async () => {
		if (!component) return;
		setInstallError('');
		markInstalling(component.name);
		try {
			await installComponentWithOcx(component.name);
			await queryClient.invalidateQueries({ queryKey: skillsKeys.all });
		} catch (err) {
			setInstallError(err instanceof Error ? err.message : 'Install failed');
		} finally {
			clearInstalling(component.name);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-5xl w-[calc(100vw-2rem)] h-[80vh] grid grid-rows-[auto_1fr] gap-0 p-0 border-border/50 bg-background overflow-hidden">
				<DialogTitle className="sr-only">
					{component?.name} — Details
				</DialogTitle>

				{/* Header */}
				<div className="px-6 sm:px-8 py-5 border-b border-border/50">
					<div className="flex items-start justify-between gap-6 pr-8">
						<div className="min-w-0">
							<div className="flex items-center gap-2 flex-wrap">
								<h2 className="text-sm font-semibold text-foreground">{component?.name}</h2>
								{component && (
									<Badge variant="secondary" className="text-[10px]">{kindLabel(component.type)}</Badge>
								)}
								{bundle?.version.version && (
									<Badge variant="outline" className="text-[10px]">v{bundle.version.version}</Badge>
								)}
								{isInstalled && (
									<Badge variant="highlight" className="text-[10px]">Installed</Badge>
								)}
							</div>
							{component?.description && (
								<p className="mt-2 text-sm text-muted-foreground max-w-2xl leading-relaxed">
									{component.description}
								</p>
							)}
						</div>
						<div className="flex items-center gap-2 shrink-0">
							<Button
								variant="outline"
								size="sm"
								className="px-3 text-xs"
								onClick={() => component && navigator.clipboard.writeText(component.name)}
							>
								Copy
							</Button>
							<Button
								variant="default"
								size="sm"
								className="px-3 text-xs"
								onClick={handleInstall}
								disabled={!component || isInstalling || isInstalled}
							>
								{isInstalling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isInstalled ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
								{isInstalling ? 'Installing' : isInstalled ? 'Installed' : 'Install'}
							</Button>
						</div>
					</div>
					{installError && <p className="mt-3 text-xs text-destructive">{installError}</p>}
				</div>

				{/* Body */}
				<div className="grid grid-cols-[220px_1fr] min-h-0">
					{/* File tree */}
					<div className="border-r border-border/50 overflow-y-auto">
						<div className="sticky top-0 px-4 py-3 border-b border-border/50 bg-background">
							<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Files</span>
						</div>
						<div className="p-2">
							{isLoading ? (
								<div className="flex items-center justify-center py-8">
									<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
								</div>
							) : error ? (
								<p className="px-3 py-4 text-xs text-destructive">{error.message}</p>
							) : (
								bundle?.files.map((file) => (
									<button
										key={file.path}
										onClick={() => setSelectedPath(file.path)}
										className={cn(
											'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors cursor-pointer',
											activePath === file.path
												? 'bg-foreground text-background'
												: 'text-foreground hover:bg-muted',
										)}
									>
										<FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
										<span className="truncate text-xs">{formatPath(file.path)}</span>
									</button>
								))
							)}
						</div>
					</div>

					{/* File content */}
					<div className="overflow-y-auto bg-background p-6">
						{activeFile ? (
							<pre className="text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap font-mono">
								<code>{activeFile.content}</code>
							</pre>
						) : (
							<div className="flex items-center justify-center h-full text-xs text-muted-foreground">
								Select a file to preview
							</div>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

// ── Component Card ────────────────────────────────────────────────────────────

function ComponentCard({
	component,
	onOpen,
	index,
}: {
	component: RegistryComponent;
	onOpen: (c: RegistryComponent) => void;
	index: number;
}) {
	const [error, setError] = useState('');
	const queryClient = useQueryClient();
	const installedSkills = useInstalledSkillNames();
	const { installing, markInstalling, clearInstalling } = useMarketplaceStore();
	const isInstalled = installedSkills.has(component.name.toLowerCase());
	const isInstalling = installing.includes(component.name);

	const handleInstall = async (e: React.MouseEvent) => {
		e.stopPropagation();
		setError('');
		markInstalling(component.name);
		try {
			await installComponentWithOcx(component.name);
			await queryClient.invalidateQueries({ queryKey: skillsKeys.all });
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Install failed');
		} finally {
			clearInstalling(component.name);
		}
	};

	return (
		<>
			<WorkspaceItemCard
				item={{
					id: component.name,
					name: component.name,
					description: component.description,
					kindLabel: kindLabel(component.type),
					meta: `v${component.version}`,
				}}
				index={index}
				onClick={() => onOpen(component)}
				actions={
					isInstalled ? (
						<Button
							variant="ghost"
							className="text-muted-foreground hover:text-foreground h-8 px-2.5 text-xs"
							onClick={(e) => { e.stopPropagation(); onOpen(component); }}
						>
							<Check className="h-3.5 w-3.5" />
							Installed
						</Button>
					) : (
						<Button
							variant="default"
							size="sm"
							className="px-3 text-xs"
							onClick={handleInstall}
							disabled={isInstalling}
						>
							{isInstalling
								? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
								: <Download className="h-3.5 w-3.5" />
							}
							{isInstalling ? 'Installing' : 'Install'}
						</Button>
					)
				}
			/>
			{error && <p className="mt-1 text-xs text-destructive px-1">{error}</p>}
		</>
	);
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
			{Array.from({ length: 8 }).map((_, i) => (
				<div key={i} className="rounded-2xl border bg-card p-4 sm:p-5">
					<div className="mb-3 space-y-2">
						<Skeleton className="h-4 w-32" />
						<Skeleton className="h-3 w-16" />
					</div>
					<Skeleton className="h-3 w-full mb-1" />
					<Skeleton className="h-3 w-4/5 mb-4" />
					<div className="flex justify-end">
						<Skeleton className="h-8 w-20" />
					</div>
				</div>
			))}
		</div>
	);
}

// ── Empty state ───────────────────────────────────────────────────────────────

function MarketplaceEmptyState({ searchQuery, filter }: { searchQuery: string; filter: FilterKey }) {
	const icon = filter === 'installed' ? <Package className="h-7 w-7 text-muted-foreground/30" /> : <Sparkles className="h-7 w-7 text-muted-foreground/30" />;
	const title = searchQuery
		? `No results for "${searchQuery}"`
		: filter === 'installed'
			? 'Nothing installed yet'
			: 'No components found';
	const sub = searchQuery
		? undefined
		: filter === 'installed'
			? 'Browse the marketplace and install skills, agents, tools, or plugins.'
			: 'No components are available in this category right now.';

	return (
		<div className="flex flex-col items-center justify-center py-20 rounded-xl border border-dashed border-border/50">
			{icon}
			<p className="mt-3 text-sm font-medium text-foreground">{title}</p>
			{sub && <p className="mt-1 text-xs text-muted-foreground text-center max-w-xs">{sub}</p>}
		</div>
	);
}

// ── Filter pill ───────────────────────────────────────────────────────────────

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<Button
			onClick={onClick}
			variant={active ? 'outline' : 'ghost'}
			size="sm"
			className={cn(!active && 'text-muted-foreground hover:text-foreground')}
		>
			{children}
		</Button>
	);
}

// ── Main Marketplace ──────────────────────────────────────────────────────────

export function Marketplace() {
	const [search, setSearch] = useState('');
	const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
	const [selectedComponent, setSelectedComponent] = useState<RegistryComponent | null>(null);
	const { data: components, isLoading, error } = useMarketplaceSkills();
	const installedSkills = useInstalledSkillNames();

	const counts = useMemo(() => {
		const list = components ?? [];
		return {
			all:       list.length,
			installed: list.filter((i) => installedSkills.has(i.name.toLowerCase())).length,
			skills:    list.filter((i) => i.type === 'ocx:skill').length,
			agents:    list.filter((i) => i.type === 'ocx:agent').length,
			tools:     list.filter((i) => i.type === 'ocx:tool').length,
			plugins:   list.filter((i) => i.type === 'ocx:plugin').length,
		};
	}, [components, installedSkills]);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return (components ?? []).filter((c) => {
			const matches = !q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
			if (!matches) return false;
			switch (activeFilter) {
				case 'installed': return installedSkills.has(c.name.toLowerCase());
				case 'skills':    return c.type === 'ocx:skill';
				case 'agents':    return c.type === 'ocx:agent';
				case 'tools':     return c.type === 'ocx:tool';
				case 'plugins':   return c.type === 'ocx:plugin';
				default:          return true;
			}
		});
	}, [activeFilter, components, installedSkills, search]);

	return (
		<>
			<div className="flex-1 overflow-y-auto">
				{/* Page header */}
				<div className="container mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-8 animate-in fade-in-0 slide-in-from-bottom-4 duration-500 fill-mode-both">
					<PageHeader icon={Sparkles}>
						<div className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight">
							<span className="text-primary">Marketplace</span>
						</div>
					</PageHeader>
				</div>

				<div className="container mx-auto max-w-7xl px-3 sm:px-4">
					{/* Search + filter */}
					<div className="flex items-center gap-2 pb-3 pt-1 animate-in fade-in-0 slide-in-from-bottom-4 duration-500 fill-mode-both delay-75">
						<div className="relative flex-1 max-w-sm">
							<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
							<input
								type="text"
								placeholder="Search components..." autoComplete="off"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-8 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
							/>
							{search && (
              <Button onClick={() => setSearch('')} variant="ghost" size="icon-xs" className="absolute right-2.5 top-1/2 -translate-y-1/2">
								<X className="h-3.5 w-3.5" />
							</Button>
							)}
						</div>

						<FilterBar className="hidden sm:inline-flex">
							{FILTERS.map((f) => (
								<FilterBarItem
									key={f.key}
									value={f.key}
									onClick={() => setActiveFilter(f.key)}
									data-state={activeFilter === f.key ? 'active' : 'inactive'}
								>
									{f.label}
									{counts[f.key] > 0 && <span className="ml-1 opacity-50 tabular-nums">{counts[f.key]}</span>}
								</FilterBarItem>
							))}
						</FilterBar>

						<select
							value={activeFilter}
							onChange={(e) => setActiveFilter(e.target.value as FilterKey)}
							className="sm:hidden h-9 rounded-lg border border-input bg-card px-3 text-sm cursor-pointer"
						>
							{FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label} ({counts[f.key]})</option>)}
						</select>
					</div>

					{/* Content */}
					<div className="pb-8 animate-in fade-in-0 slide-in-from-bottom-4 duration-500 fill-mode-both delay-150">
						{isLoading ? (
							<LoadingSkeleton />
						) : error ? (
							<div className="py-12 text-center">
								<p className="text-sm text-destructive">Failed to load marketplace</p>
								<p className="text-xs text-muted-foreground mt-1">{error.message}</p>
							</div>
						) : filtered.length === 0 ? (
							<MarketplaceEmptyState searchQuery={search} filter={activeFilter} />
						) : (
							<>
								<div className="flex items-center gap-2 mb-4">
									<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
										{activeFilter === 'all' ? 'All' : activeFilter === 'installed' ? 'Installed' : activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1)}
									</span>
									<span className="text-xs tabular-nums text-muted-foreground/50">{filtered.length}</span>
								</div>

								<AnimatePresence mode="popLayout">
									<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
										{filtered.map((c, index) => (
											<ComponentCard
												key={c.name}
												component={c}
												onOpen={setSelectedComponent}
												index={index}
											/>
										))}
									</div>
								</AnimatePresence>
							</>
						)}
					</div>
				</div>
			</div>

			<ComponentDetailModal
				component={selectedComponent}
				open={Boolean(selectedComponent)}
				onOpenChange={(open) => !open && setSelectedComponent(null)}
			/>
		</>
	);
}
