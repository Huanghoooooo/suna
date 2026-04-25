const fs = require('node:fs/promises');
const path = require('node:path');

const APP_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SKILLS_ROOT = path.join(APP_ROOT, 'skills');

const BUILT_IN_SKILLS = {
  invoice: {
    envVar: 'WUTONG_INVOICE_SKILL_DIR',
    relativePath: 'invoice',
  },
  'lingxing-sta-workflow': {
    envVar: 'WUTONG_STA_SKILL_DIR',
    relativePath: 'lingxing-sta-workflow',
  },
  'lingxing-openapi': {
    envVar: 'WUTONG_LINGXING_OPENAPI_DIR',
    relativePath: 'lingxing-openapi',
  },
};

function skillsRoot() {
  return path.resolve(process.env.WUTONG_SKILLS_ROOT || DEFAULT_SKILLS_ROOT);
}

function skillPath(name) {
  const entry = BUILT_IN_SKILLS[name];
  if (!entry) {
    throw new Error(`Unknown built-in skill: ${name}`);
  }
  return path.resolve(process.env[entry.envVar] || path.join(skillsRoot(), entry.relativePath));
}

async function readSkillMetadata(name) {
  const root = skillPath(name);
  const skillMd = path.join(root, 'SKILL.md');
  let metadata = { name, description: '' };
  try {
    const text = await fs.readFile(skillMd, 'utf8');
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (match) {
      for (const line of match[1].split(/\r?\n/)) {
        const pair = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
        if (pair) {
          metadata[pair[1]] = pair[2].replace(/^["']|["']$/g, '');
        }
      }
    }
  } catch {
    metadata.missing = true;
  }
  return {
    ...metadata,
    path: root,
  };
}

async function listBuiltInSkills() {
  return Promise.all(Object.keys(BUILT_IN_SKILLS).map(readSkillMetadata));
}

module.exports = {
  DEFAULT_SKILLS_ROOT,
  listBuiltInSkills,
  skillPath,
  skillsRoot,
};
