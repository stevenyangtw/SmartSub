/**
 * 構建信息注入腳本
 * 從環境變量中讀取構建平臺和架構信息，然後將這些信息寫入package.json
 *
 * 注意：CUDA 加速包已改為運行時動態下載，不再在構建時綁定特定版本
 */

const fs = require('fs');
const path = require('path');

// 獲取package.json路徑
const packageJsonPath = path.join(process.cwd(), 'package.json');

try {
  // 讀取package.json
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  // 從環境變量中獲取構建信息
  const platform = process.env.BUILD_PLATFORM;
  const arch = process.env.BUILD_ARCH;

  // 創建buildInfo對象
  const buildInfo = {
    platform,
    arch,
    buildDate: new Date().toISOString(),
  };

  // 將buildInfo寫入package.json
  packageJson.buildInfo = buildInfo;

  // 寫入更新後的package.json
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

  console.log('Build info injected successfully:', buildInfo);
} catch (error) {
  console.error('Error injecting build info:', error);
  process.exit(1);
}
