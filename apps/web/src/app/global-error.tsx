'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Kortix Global Error]', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          backgroundColor: '#111',
          color: '#e0e0e0',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Scanline overlay */}
        <div
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 1,
            opacity: 0.04,
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)',
            backgroundSize: '100% 4px',
          }}
        />

        {/* Noise texture */}
        <div
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 1,
            opacity: 0.06,
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'repeat',
            backgroundSize: '256px 256px',
          }}
        />

        {/* Vignette */}
        <div
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 1,
            background:
              'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%)',
          }}
        />

        <div
          style={{
            position: 'relative',
            zIndex: 2,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '32px',
            maxWidth: '480px',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          {/* ASCII fault indicator */}
          <pre
            style={{
              margin: 0,
              fontSize: '11px',
              lineHeight: 1.4,
              color: 'rgba(255,255,255,0.06)',
              letterSpacing: '0.05em',
              userSelect: 'none',
            }}
          >
{`
 ┌─────────────────────────┐
 │  KORTIX SYSTEM FAULT    │
 │  ████████░░░░░ 58%      │
 │  recovery in progress   │
 └─────────────────────────┘
`}
          </pre>

          {/* K logo mark — pure CSS */}
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '10px',
              border: '1.5px solid rgba(255,255,255,0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              fontWeight: 700,
              color: 'rgba(255,255,255,0.5)',
              letterSpacing: '-0.02em',
            }}
          >
            K
          </div>

          {/* Title */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h1
              style={{
                margin: 0,
                fontSize: '24px',
                fontWeight: 400,
                fontFamily:
                  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                color: '#e8e8e8',
                letterSpacing: '-0.02em',
              }}
            >
              System Fault
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: '14px',
                lineHeight: 1.6,
                color: 'rgba(255,255,255,0.4)',
              }}
            >
              A critical error occurred that prevented the application from loading.
              This has been logged automatically.
            </p>
          </div>

          {/* Error details */}
          <div
            style={{
              width: '100%',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.08)',
              backgroundColor: 'rgba(255,255,255,0.03)',
              textAlign: 'left',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: 'rgba(255,255,255,0.25)',
                marginBottom: '8px',
              }}
            >
              Error Details
            </div>
            <div
              style={{
                fontSize: '13px',
                color: 'rgba(255,255,255,0.55)',
                wordBreak: 'break-word',
                lineHeight: 1.5,
              }}
            >
              {error.message && error.message.length < 300
                ? error.message
                : 'An unrecoverable error occurred.'}
            </div>
            {error.digest && (
              <div
                style={{
                  marginTop: '8px',
                  fontSize: '11px',
                  color: 'rgba(255,255,255,0.2)',
                }}
              >
                ref: {error.digest}
              </div>
            )}
          </div>

          {/* Status */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              borderRadius: '999px',
              border: '1px solid rgba(255,255,255,0.08)',
              backgroundColor: 'rgba(255,255,255,0.02)',
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: '#d97706',
                animation: 'kortix-fault-pulse 2s ease-in-out infinite',
              }}
            />
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>
              system fault detected
            </span>
          </div>

          {/* Reload button */}
          <button
            onClick={() => window.location.reload()}
            style={{
              width: '100%',
              padding: '14px 24px',
              borderRadius: '999px',
              border: 'none',
              backgroundColor: 'rgba(255,255,255,0.9)',
              color: '#111',
              fontSize: '14px',
              fontWeight: 500,
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              cursor: 'pointer',
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.9)';
            }}
          >
            Reload Application
          </button>

          {/* Timestamp */}
          <div
            style={{
              fontSize: '11px',
              color: 'rgba(255,255,255,0.15)',
              letterSpacing: '0.05em',
            }}
          >
            {new Date().toISOString()}
          </div>
        </div>

        {/* Inline keyframes — self-contained, no external CSS */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              @keyframes kortix-fault-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.3; }
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
