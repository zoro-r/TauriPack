#!/usr/bin/env node
/**
 * 静态资源服务测试脚本
 */

const http = require('http');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const TEST_FILES = [
  '/static/test.txt',
  '/static/index.html',
  '/static/css/custom.css',
  '/static/js/utils.js'
];

function testStaticResource(url) {
  return new Promise((resolve, reject) => {
    const fullUrl = BASE_URL + url;
    console.log(`测试: ${fullUrl}`);
    
    http.get(fullUrl, (res) => {
      let data = '';
      
      res.on('data', chunk => {
        data += chunk;
      });
      
      res.on('end', () => {
        const result = {
          url,
          status: res.statusCode,
          contentType: res.headers['content-type'],
          size: data.length,
          success: res.statusCode === 200
        };
        resolve(result);
      });
    }).on('error', (err) => {
      reject({ url, error: err.message });
    });
  });
}

async function runTests() {
  console.log('🚀 开始测试静态资源服务...\n');
  
  const results = [];
  
  for (const url of TEST_FILES) {
    try {
      const result = await testStaticResource(url);
      results.push(result);
      
      if (result.success) {
        console.log(`✅ ${result.url} - ${result.status} (${result.contentType}) - ${result.size} bytes`);
      } else {
        console.log(`❌ ${result.url} - ${result.status}`);
      }
    } catch (error) {
      console.log(`❌ ${error.url} - ERROR: ${error.error}`);
      results.push({ url: error.url, success: false, error: error.error });
    }
  }
  
  console.log('\n📊 测试汇总:');
  const successful = results.filter(r => r.success).length;
  const total = results.length;
  
  console.log(`成功: ${successful}/${total}`);
  
  if (successful === total) {
    console.log('\n🎉 所有测试通过！静态资源服务配置正确。');
    console.log(`\n🔗 访问测试页面: ${BASE_URL}/static/index.html`);
  } else {
    console.log('\n⚠️  部分测试失败，请检查服务器配置。');
  }
}

// 检查服务器是否启动
console.log('检查服务器状态...');
http.get(BASE_URL + '/api/health', (res) => {
  if (res.statusCode === 404) {
    // 404 是正常的，说明服务器在运行但没有 health 接口
    runTests();
  } else {
    runTests();
  }
}).on('error', () => {
  console.log('❌ 服务器未启动！请先运行: npm run dev');
  console.log('然后再执行此测试脚本: node test-static.js');
  process.exit(1);
});