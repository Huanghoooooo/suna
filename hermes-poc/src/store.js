const fs = require('node:fs/promises');
const path = require('node:path');

function nowIso() {
  return new Date().toISOString();
}

function defaultState() {
  return {
    createdAt: nowIso(),
    conversations: [],
    tasks: [],
    files: [],
    metrics: {
      profitToday: 128430,
      expenseToday: 19420,
      exchangeRate: 7.23,
      pendingInvoices: 8,
      shipmentWarnings: 3,
    },
  };
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.statePath = path.join(dataDir, 'state.json');
    this.fileRoot = path.join(dataDir, 'files');
    this.queue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.fileRoot, { recursive: true });
    try {
      await fs.access(this.statePath);
    } catch {
      await fs.writeFile(this.statePath, `${JSON.stringify(defaultState(), null, 2)}\n`, 'utf8');
    }
  }

  async read() {
    await this.init();
    const text = await fs.readFile(this.statePath, 'utf8');
    return JSON.parse(text);
  }

  async write(state) {
    await fs.writeFile(this.statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  async update(mutator) {
    this.queue = this.queue.then(async () => {
      const state = await this.read();
      const result = await mutator(state);
      await this.write(state);
      return result;
    });
    return this.queue;
  }

  async upsertTask(task) {
    return this.update((state) => {
      const index = state.tasks.findIndex((item) => item.id === task.id);
      if (index >= 0) {
        state.tasks[index] = task;
      } else {
        state.tasks.unshift(task);
      }
      return task;
    });
  }

  async getTask(taskId) {
    const state = await this.read();
    return state.tasks.find((task) => task.id === taskId) || null;
  }

  async addFile(file) {
    return this.update((state) => {
      state.files.unshift(file);
      const task = state.tasks.find((item) => item.id === file.taskId);
      if (task && !task.files.includes(file.id)) {
        task.files.push(file.id);
        task.updatedAt = nowIso();
      }
      return file;
    });
  }
}

module.exports = {
  Store,
  nowIso,
};
