import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

await sharp('artwork/toolbox.svg').resize(1024, 1024).png().toFile('artwork/toolbox.png');
const temporary = await mkdtemp(join(tmpdir(), 'toolbox-icons-'));
try {
  const result = spawnSync('pnpm', ['exec', 'tauri', 'icon', 'artwork/toolbox.png', '--output', temporary], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('图标生成失败');
  await mkdir('src-tauri/icons', { recursive: true });
  for (const name of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.icns']) {
    await copyFile(join(temporary, name), join('src-tauri/icons', name));
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
