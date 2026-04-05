'use client';

import { useMemo, useState, useEffect, useRef, Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFileContent } from '../hooks';
import { getFileCategory, getLanguageFromExt } from './file-content-renderer';
import { getFileIcon } from './file-icon';
import { useSandboxProxy } from '@/hooks/use-sandbox-proxy';
import { SANDBOX_PORTS } from '@/lib/platform-client';

/** Ensure a sandbox file path starts with /workspace/ for the static file server. */
function ensureWorkspacePath(filePath: string): string {
  if (filePath.startsWith('/workspace/')) return filePath;
  return '/workspace/' + filePath.replace(/^\/+/, '');
}

// ---------------------------------------------------------------------------
// Image Thumbnail — loads base64 from API
// ---------------------------------------------------------------------------

function ImageThumbnail({ filePath }: { filePath: string }) {
  const { data: fileContent } = useFileContent(filePath, { staleTime: 60_000 });
  const [imgError, setImgError] = useState(false);

  const dataUrl = useMemo(() => {
    if (fileContent?.encoding === 'base64' && fileContent.mimeType?.startsWith('image/')) {
      return `data:${fileContent.mimeType};base64,${fileContent.content}`;
    }
    return null;
  }, [fileContent]);

  if (!dataUrl || imgError) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dataUrl}
      alt=""
      className="absolute inset-0 w-full h-full object-cover"
      onError={() => setImgError(true)}
      draggable={false}
    />
  );
}

// ---------------------------------------------------------------------------
// Code / Text Thumbnail — shows first ~8 lines of content
// ---------------------------------------------------------------------------

function CodeThumbnail({ filePath }: { filePath: string }) {
  const { data: fileContent } = useFileContent(filePath, { staleTime: 60_000 });

  const preview = useMemo(() => {
    if (!fileContent?.content || fileContent.type === 'binary') return null;
    const lines = fileContent.content.split('\n').slice(0, 10);
    return lines.join('\n');
  }, [fileContent]);

  if (!preview) return null;

  return (
    <div className="absolute inset-0 p-2 overflow-hidden">
      <pre className="text-[7px] leading-[1.4] text-muted-foreground/70 font-mono whitespace-pre overflow-hidden select-none pointer-events-none">
        {preview}
      </pre>
      {/* Fade-out gradient at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-muted/20 to-transparent" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown Thumbnail — shows rendered preview snippet
// ---------------------------------------------------------------------------

function MarkdownThumbnail({ filePath }: { filePath: string }) {
  const { data: fileContent } = useFileContent(filePath, { staleTime: 60_000 });

  const preview = useMemo(() => {
    if (!fileContent?.content) return null;
    // Show first ~150 chars of markdown, strip headers/links for brief display
    const text = fileContent.content
      .replace(/^#{1,6}\s+/gm, '') // strip heading markers
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) -> text
      .replace(/[*_`~]/g, '') // strip formatting markers
      .trim();
    return text.slice(0, 200);
  }, [fileContent]);

  if (!preview) return null;

  return (
    <div className="absolute inset-0 p-2.5 overflow-hidden">
      <p className="text-[8px] leading-[1.5] text-muted-foreground/60 select-none pointer-events-none line-clamp-[8]">
        {preview}
      </p>
      <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-muted/20 to-transparent" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSV / Spreadsheet Thumbnail — shows a mini table
// ---------------------------------------------------------------------------

function CsvThumbnail({ filePath }: { filePath: string }) {
  const { data: fileContent } = useFileContent(filePath, { staleTime: 60_000 });

  const rows = useMemo(() => {
    if (!fileContent?.content) return null;
    const lines = fileContent.content.split('\n').filter(Boolean).slice(0, 6);
    return lines.map((line) => {
      const sep = line.includes('\t') ? '\t' : ',';
      return line.split(sep).slice(0, 5).map((cell) => cell.replace(/^"(.*)"$/, '$1').trim());
    });
  }, [fileContent]);

  if (!rows || rows.length === 0) return null;

  return (
    <div className="absolute inset-0 p-2 overflow-hidden">
      <table className="w-full text-[7px] text-muted-foreground/60 select-none pointer-events-none border-collapse">
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i === 0 ? 'font-medium text-muted-foreground/80' : ''}>
              {row.map((cell, j) => (
                <td key={j} className="px-0.5 py-px truncate max-w-[60px] border-b border-border/20">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-muted/20 to-transparent" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON Thumbnail — shows formatted JSON preview
// ---------------------------------------------------------------------------

function JsonThumbnail({ filePath }: { filePath: string }) {
  const { data: fileContent } = useFileContent(filePath, { staleTime: 60_000 });

  const preview = useMemo(() => {
    if (!fileContent?.content) return null;
    try {
      const parsed = JSON.parse(fileContent.content);
      return JSON.stringify(parsed, null, 2).split('\n').slice(0, 10).join('\n');
    } catch {
      return fileContent.content.split('\n').slice(0, 10).join('\n');
    }
  }, [fileContent]);

  if (!preview) return null;

  return (
    <div className="absolute inset-0 p-2 overflow-hidden">
      <pre className="text-[7px] leading-[1.4] text-muted-foreground/70 font-mono whitespace-pre overflow-hidden select-none pointer-events-none">
        {preview}
      </pre>
      <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-muted/20 to-transparent" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// HTML Thumbnail — scaled iframe preview via static file server (port 3211)
// ---------------------------------------------------------------------------

function HtmlThumbnail({ filePath }: { filePath: string }) {
  const { rewritePortPath } = useSandboxProxy();
  const staticPort = parseInt(SANDBOX_PORTS.STATIC_FILE_SERVER ?? '3211', 10);

  // Proxy URL for the file itself
  const previewUrl = useMemo(() => {
    const normalizedPath = ensureWorkspacePath(filePath);
    const encodedPath = normalizedPath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return rewritePortPath(staticPort, `/open?path=/${encodedPath}`);
  }, [filePath, rewritePortPath, staticPort]);

  // Health URL — poll until server is ready
  const healthUrl = useMemo(
    () => rewritePortPath(staticPort, '/health'),
    [rewritePortPath, staticPort],
  );

  const [ready, setReady] = useState(false);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!healthUrl) return;
    let cancelled = false;
    setReady(false);

    async function check() {
      try {
        const res = await fetch(healthUrl, { method: 'GET', credentials: 'include' });
        if (cancelled) return;
        if (res.ok) { setReady(true); return; }
      } catch { /* not ready yet */ }
      if (!cancelled) retryRef.current = setTimeout(check, 1500);
    }

    check();
    return () => {
      cancelled = true;
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [healthUrl]);

  // Container ref for scaling the iframe to fit
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(w / 1280);
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden select-none pointer-events-none">
      {!ready || scale === 0 ? (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/30" />
        </div>
      ) : (
        <iframe
          src={previewUrl}
          title=""
          className="border-0 origin-top-left"
          style={{
            width: `${1280}px`,
            height: `${Math.round(1280 / (containerRef.current!.clientWidth / containerRef.current!.clientHeight || 1))}px`,
            transform: `scale(${scale})`,
          }}
          sandbox="allow-scripts allow-same-origin"
          tabIndex={-1}
        />
      )}
      {/* Fade overlay so the badge stays readable */}
      <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-muted/30 to-transparent" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main FileThumbnail — picks the right thumbnail based on file type
// ---------------------------------------------------------------------------

interface FileThumbnailProps {
  filePath: string;
  fileName: string;
  className?: string;
}

/**
 * Renders a rich thumbnail preview for grid file cards.
 * 
 * Supported:
 * - Images: actual image preview
 * - Code/text: first lines of source code
 * - Markdown: rendered text snippet
 * - CSV/TSV: mini table
 * - JSON: formatted JSON preview
 * - Everything else: large icon fallback
 */
export function FileThumbnail({ filePath, fileName, className }: FileThumbnailProps) {
  const category = getFileCategory(fileName);
  const language = getLanguageFromExt(fileName);
  const isMarkdown = language === 'markdown';
  const isJson = language === 'json';
  const isCsv = category === 'csv';
  const isImage = category === 'image';
  const isHtml = category === 'html';
  const isCode = category === 'code' && !isJson;
  // Treat plaintext files (.txt, .rst, .rtf, .log, etc.) as text even when
  // getFileCategory returns 'binary' (it needs mimeType we don't have here)
  const extLower = fileName.split('.').pop()?.toLowerCase() || '';
  const nameLower = fileName.toLowerCase();
  const isPlaintext = ['txt', 'rst', 'rtf', 'log', 'text', 'nfo', 'cfg', 'ini', 'conf', 'properties'].includes(extLower)
    || ['.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc', '.prettierrc', '.eslintrc', 'license', 'readme', 'changelog', 'makefile', 'dockerfile'].some(n => nameLower === n || nameLower.endsWith(n));
  const isText = category === 'text' || isMarkdown || isPlaintext;
  const ext = fileName.includes('.') ? extLower.toUpperCase() : '';

  return (
    <div className={cn('flex items-center justify-center relative overflow-hidden bg-muted/20', className)}>
      {/* Thumbnails by type */}
      {isImage && <ImageThumbnail filePath={filePath} />}
      {isHtml && <HtmlThumbnail filePath={filePath} />}
      {isCode && <CodeThumbnail filePath={filePath} />}
      {isMarkdown && <MarkdownThumbnail filePath={filePath} />}
      {isJson && <JsonThumbnail filePath={filePath} />}
      {isCsv && <CsvThumbnail filePath={filePath} />}
      {isText && !isMarkdown && <CodeThumbnail filePath={filePath} />}

      {/* Fallback icon for binary / unsupported types */}
      {!isImage && !isHtml && !isCode && !isMarkdown && !isJson && !isCsv && !isText && (
        getFileIcon(fileName, { className: 'h-12 w-12', variant: 'monochrome' })
      )}

      {/* File type badge (shown for non-image types) */}
      {ext && !isImage && (
        <span className="absolute bottom-1.5 right-1.5 text-[0.5625rem] font-medium text-muted-foreground/50 uppercase tracking-wider bg-background/80 px-1.5 py-0.5 rounded z-10">
          {ext}
        </span>
      )}
    </div>
  );
}
