import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { Icns, IcnsImage } from '@fiahfy/icns';

const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const createPngBuffers = async (inputPath: string, sizes: number[]) => {
  const buffers = await Promise.all(
    sizes.map((size) =>
      sharp(inputPath)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer()
    )
  );
  return buffers;
};

export const convertPngToIcons = async (
  inputPath: string,
  outputDir: string,
  name: string
) => {
  ensureDir(outputDir);

  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icnsSizes = [16, 32, 64, 128, 256, 512, 1024];

  const icoBuffers = await createPngBuffers(inputPath, icoSizes);
  const icnsBuffers = await createPngBuffers(inputPath, icnsSizes);

  const icoBuffer = await pngToIco(icoBuffers);
  const icoData = new Uint8Array(icoBuffer);
  const icoPath = path.join(outputDir, `${name}.ico`);
  fs.writeFileSync(icoPath, icoData);

  const icns = new Icns();
  const icnsTypeBySize: Record<number, 'icp4' | 'icp5' | 'icp6' | 'ic07' | 'ic08' | 'ic09' | 'ic10'> = {
    16: 'icp4',
    32: 'icp5',
    64: 'icp6',
    128: 'ic07',
    256: 'ic08',
    512: 'ic09',
    1024: 'ic10'
  };
  icnsBuffers.forEach((buffer, index) => {
    const size = icnsSizes[index];
    const osType = icnsTypeBySize[size];
    if (!osType) {
      return;
    }
    icns.append(IcnsImage.fromPNG(buffer, osType));
  });
  const icnsPath = path.join(outputDir, `${name}.icns`);
  const icnsData = (icns as unknown as { data: Uint8Array }).data;
  fs.writeFileSync(icnsPath, icnsData);

  return { icoPath, icnsPath };
};
