const { cp } = require('node:fs/promises');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const resources = electronPlatformName === 'darwin'
    ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(appOutDir, 'resources');
  const from = path.join(packager.projectDir, 'build', 'runtime');
  const to = path.join(resources, 'runtime');
  await cp(from, to, { recursive: true, dereference: true });
  console.log(`[after-pack] runtime copied to ${to}`);
};
