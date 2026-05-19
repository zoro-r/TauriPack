import https from 'https';

export const httpsGetJson = <T>(url: string): Promise<T> =>
  new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks: Uint8Array[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(new Uint8Array(chunk)));
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            resolve(JSON.parse(body) as T);
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);
  });
