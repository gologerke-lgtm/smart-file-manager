const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { GoogleGenAI, Type } = require('@google/genai');

const undoLogPath = path.join(app.getPath('userData'), 'undo-history.json');
const configPath = path.join(app.getPath('userData'), 'config.json');

function createWindow() {
  const win = new BrowserWindow({
    width: 920,
    height: 720,
    backgroundColor: '#121212',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

const categories = {
  Images: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'],
  Documents: ['.pdf', '.docx', '.doc', '.txt', '.xlsx', '.xls', '.csv', '.pptx'],
  Videos: ['.mp4', '.mkv', '.mov', '.avi', '.webm'],
  Audio: ['.mp3', '.wav', '.aac', '.flac', '.ogg'],
  Archives: ['.zip', '.rar', '.7z', '.tar', '.gz'],
  Installers: ['.exe', '.msi'],
  AndroidApps: ['.apk', '.xapk'],
  Code: ['.js', '.py', '.html', '.css', '.json', '.ts']
};

function getSavedApiKey() {
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8')).apiKey || '';
    } catch {
      return '';
    }
  }
  return '';
}

ipcMain.handle('get-api-key', () => getSavedApiKey());

ipcMain.handle('save-api-key', (event, apiKey) => {
  fs.writeFileSync(configPath, JSON.stringify({ apiKey: apiKey.trim() }, null, 2));
  return true;
});

function resolveFolderByName(folderName) {
  const home = os.homedir();
  const key = (folderName || 'desktop').toLowerCase();
  if (key.includes('download')) return path.join(home, 'Downloads');
  if (key.includes('document')) return path.join(home, 'Documents');
  if (key.includes('picture') || key.includes('image')) return path.join(home, 'Pictures');
  if (key.includes('video')) return path.join(home, 'Videos');
  if (key.includes('music') || key.includes('audio')) return path.join(home, 'Music');
  return path.join(home, 'Desktop');
}

function saveUndoHistory(moves) {
  if (moves.length > 0) {
    fs.writeFileSync(undoLogPath, JSON.stringify(moves, null, 2));
  }
}

function sortDirectory(sourceDir, dryRun = false, filterExt = null, customDestDir = null) {
  if (!fs.existsSync(sourceDir)) {
    return [`Folder not found: ${sourceDir}`];
  }

  const items = fs.readdirSync(sourceDir);
  const logs = new Array();
  const moves = new Array();

  items.forEach(item => {
    const fullPath = path.join(sourceDir, item);
    let stats;
    try {
      stats = fs.lstatSync(fullPath);
    } catch {
      return;
    }

    if (stats.isDirectory() || path.extname(item).toLowerCase() === '.lnk') return;

    const ext = path.extname(item).toLowerCase();
    if (filterExt && ext !== filterExt) return;

    let folderName = 'Others';
    for (const [category, extensions] of Object.entries(categories)) {
      if (extensions.includes(ext)) {
        folderName = category;
        break;
      }
    }

    const destDir = customDestDir ? customDestDir : path.join(sourceDir, folderName);
    let destPath = path.join(destDir, item);

    if (fs.existsSync(destPath)) {
      const base = path.basename(item, ext);
      destPath = path.join(destDir, `${base}_${Date.now()}${ext}`);
    }

    const label = customDestDir ? path.basename(customDestDir) : folderName;

    if (dryRun) {
      logs.push(`[PREVIEW] Would move: ${item} -> ${label}/`);
    } else {
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.renameSync(fullPath, destPath);
      moves.push({ from: fullPath, to: destPath });
      logs.push(`[MOVED] ${item} -> ${label}/`);
    }
  });

  if (!dryRun) saveUndoHistory(moves);
  return logs.length ? logs : [`No matching loose files found in ${path.basename(sourceDir)}.`];
}

async function deepClean(targetDir, dryRun = false, includeTemp = true) {
  const logs = new Array();

  if (fs.existsSync(targetDir)) {
    const items = fs.readdirSync(targetDir);
    for (const item of items) {
      const fullPath = path.join(targetDir, item);
      try {
        if (fs.lstatSync(fullPath).isDirectory() && fs.readdirSync(fullPath).length === 0) {
          if (dryRun) {
            logs.push(`[PREVIEW] Would remove empty folder: ${item}/`);
          } else {
            fs.rmdirSync(fullPath);
            logs.push(`[DELETED] Empty folder: ${item}/`);
          }
        }
      } catch {}
    }

    const duplicatePattern = /\(\d+\)\.[^.]+$/;
    for (const item of items) {
      const fullPath = path.join(targetDir, item);
      try {
        if (!fs.lstatSync(fullPath).isDirectory() && duplicatePattern.test(item)) {
          if (dryRun) {
            logs.push(`[PREVIEW] Would recycle duplicate file: ${item}`);
          } else {
            await shell.trashItem(fullPath);
            logs.push(`[RECYCLED] Duplicate file: ${item}`);
          }
        }
      } catch {}
    }
  }

  if (includeTemp) {
    const tempDir = os.tmpdir();
    let tempCleaned = 0;
    let tempSkipped = 0;

    try {
      const tempItems = fs.readdirSync(tempDir);
      for (const item of tempItems) {
        const tempItemPath = path.join(tempDir, item);
        try {
          if (dryRun) {
            tempCleaned++;
          } else {
            fs.rmSync(tempItemPath, { recursive: true, force: true });
            tempCleaned++;
          }
        } catch {
          tempSkipped++;
        }
      }
      if (dryRun) {
        logs.push(`[PREVIEW] Found ${tempCleaned} temporary system items in %TEMP% ready to clean.`);
      } else {
        logs.push(`[CLEANED] Removed ${tempCleaned} temp items (${tempSkipped} active system files safely skipped).`);
      }
    } catch {
      logs.push(`[INFO] Could not read %TEMP% directory.`);
    }
  }

  return logs.length ? logs : ['System looks clean! No junk items found.'];
}

function undoLastAction() {
  if (!fs.existsSync(undoLogPath)) return ['Nothing to undo yet.'];
  const moves = JSON.parse(fs.readFileSync(undoLogPath, 'utf-8'));
  const logs = new Array();

  moves.reverse().forEach(move => {
    if (fs.existsSync(move.to)) {
      fs.renameSync(move.to, move.from);
      logs.push(`[RESTORED] ${path.basename(move.to)}`);
    }
  });

  fs.unlinkSync(undoLogPath);
  return logs.length ? logs : ['No files needed restoring.'];
}

async function parseWithGemini(prompt, apiKey) {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: 'v1beta' }
  });

  const modelsToTry = ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3-flash-preview'];
  let lastError;

  for (const modelName of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: `Convert this Windows PC file management request into an execution plan: "${prompt}"`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING, description: 'One of: sort, clean, both, undo' },
              sourceFolder: { type: Type.STRING, description: 'Desktop, Downloads, Documents, Pictures, or Videos' },
              destinationFolder: { type: Type.STRING, description: 'Optional target folder if moving across folders, otherwise empty string' },
              fileExtension: { type: Type.STRING, description: 'Optional lowercase extension with dot like .pdf or .apk, otherwise empty string' },
              cleanTemp: { type: Type.BOOLEAN, description: 'True if user wants temporary system files cleaned' },
              summary: { type: Type.STRING, description: 'Short 1-sentence confirmation of what will be done' }
            },
            required: ['action', 'sourceFolder', 'cleanTemp', 'summary']
          }
        }
      });
      return JSON.parse(response.text);
    } catch (err) {
      lastError = err;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  throw lastError;
}



ipcMain.handle('execute-prompt', async (event, { prompt, dryRun }) => {
  const text = prompt.trim();
  const apiKey = getSavedApiKey();

  if (text.toLowerCase().includes('undo')) {
    return ['Mode: UNDO', '----------------------------------------', ...undoLastAction()].join('\n');
  }

  if (apiKey) {
    try {
      const plan = await parseWithGemini(text, apiKey);
      const sourceDir = resolveFolderByName(plan.sourceFolder);
      const customDestDir = plan.destinationFolder ? resolveFolderByName(plan.destinationFolder) : null;
      const filterExt = plan.fileExtension ? (plan.fileExtension.startsWith('.') ? plan.fileExtension.toLowerCase() : `.${plan.fileExtension.toLowerCase()}`) : null;

      let output = [
        `[AI PLAN] ${plan.summary}`,
        `Source: ${sourceDir}${customDestDir ? ` -> Destination: ${customDestDir}` : ''}`,
        dryRun ? 'Mode: DRY RUN (Preview Only)' : 'Mode: LIVE EXECUTION',
        '----------------------------------------'
      ];

      if (plan.action === 'undo') {
        output.push(...undoLastAction());
      } else {
        if (plan.action === 'sort' || plan.action === 'both') {
          output.push(...sortDirectory(sourceDir, dryRun, filterExt, customDestDir));
        }
        if (plan.action === 'clean' || plan.action === 'both') {
          output.push(...(await deepClean(sourceDir, dryRun, plan.cleanTemp)));
        }
      }
      return output.join('\n');
    } catch (err) {
      return `[AI ERROR] ${err.message}\nCheck your Gemini API key or internet connection.`;
    }
  }

  const lower = text.toLowerCase();
  const targetDir = resolveFolderByName(lower);
  let output = [
    `[OFFLINE MODE] Target: ${targetDir}`,
    dryRun ? 'Mode: DRY RUN (Preview Only)' : 'Mode: LIVE EXECUTION',
    '----------------------------------------'
  ];

  const wantsSort = lower.includes('sort') || lower.includes('organize') || lower.includes('arrange') || lower.includes('move');
  const wantsClean = lower.includes('clean') || lower.includes('temp') || lower.includes('junk') || lower.includes('empty');

  if (wantsSort) output.push(...sortDirectory(targetDir, dryRun));
  if (wantsClean) output.push(...(await deepClean(targetDir, dryRun, true)));
  if (!wantsSort && !wantsClean) output.push('Paste your Gemini API key at the top to unlock full natural-language AI commands!');

  return output.join('\n');
});
