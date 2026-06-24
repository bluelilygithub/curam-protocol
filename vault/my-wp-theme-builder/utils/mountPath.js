'use strict';

function getMountPath() {
  const raw = process.env.THEME_BUILDER_MOUNT_PATH || '';
  return raw.replace(/\/$/, '');
}

function assetUrl(relativePath) {
  const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  return `${getMountPath()}${path}`;
}

module.exports = {
  getMountPath,
  assetUrl,
};
