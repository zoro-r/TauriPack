import { defineConfig } from '@umijs/max';

export default defineConfig({
  hash: true,
  title: '超本云教育AI',
  proxy: {
    '/static': {
      target: 'http://127.0.0.1:3001',
      changeOrigin: true
    }
  }
});
