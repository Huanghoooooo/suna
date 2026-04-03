export function isSafeTextDeltaPartType(partType: string | undefined): boolean {
  return partType === 'text';
}

const INTERNAL_REASONING_LINE_RE = /^(the user\b|i should\b|actually wait\b|let me\b|based on context\b|i think\b|i'll just\b|i can'?t\b|stop what\b|called the .* tool\b)/i;

function stripInternalBlocks(text: string): string {
  return text
    .replace(/```(?:json|txt)?\s*[\s\S]*?"type"\s*:\s*"reasoning"[\s\S]*?```/gi, '')
    .replace(/```(?:json|txt)?\s*[\s\S]*?"parts"\s*:\s*\[[\s\S]*?```/gi, '')
    .replace(/Called the Read tool with the following input:[\s\S]*$/gi, '')
    .replace(/<path>[\s\S]*?<\/entries>/gi, '')
    .replace(/<kortix_system>[\s\S]*?<\/kortix_system>/gi, '');
}

export function sanitizeChannelResponse(text: string): string {
  const stripped = stripInternalBlocks(text);
  const lines = stripped
    .split('\n')
    .map((line) => line.trimEnd());

  let start = 0;
  while (start < lines.length) {
    const line = lines[start]?.trim() ?? '';
    if (!line) {
      start++;
      continue;
    }
    if (INTERNAL_REASONING_LINE_RE.test(line) || line.startsWith('{') || line.startsWith('[')) {
      start++;
      continue;
    }
    break;
  }

  return lines
    .slice(start)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
