import fs from 'fs';
import path from 'path';
import { convertPngToIcons } from '@/utils/icon';

const run = async () => {
  const [inputPath, outputDirArg, nameArg] = process.argv.slice(2);
  if (!inputPath) {
    console.error('Usage: pnpm --filter basic-server convert-icon <input.png> [outputDir] [name]');
    process.exit(1);
  }

  const outputDir = outputDirArg ? path.resolve(outputDirArg) : process.cwd();
  const name = nameArg || 'icon';
  const absInput = path.resolve(inputPath);

  if (!fs.existsSync(absInput)) {
    console.error(`Input file not found: ${absInput}`);
    process.exit(1);
  }

  const { icoPath, icnsPath } = await convertPngToIcons(absInput, outputDir, name);
  console.log(`Generated: ${icoPath}`);
  console.log(`Generated: ${icnsPath}`);
};

run().catch((error) => {
  console.error('Icon conversion failed:', error);
  process.exit(1);
});
