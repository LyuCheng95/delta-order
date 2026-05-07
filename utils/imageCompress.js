/**
 * 上传前压缩本地图片（结单截图等），减轻云存储与上传耗时
 */
function compressImageForUpload(localPath) {
  return new Promise(resolve => {
    if (!localPath || typeof wx.compressImage !== 'function') {
      resolve(localPath)
      return
    }
    wx.compressImage({
      src: localPath,
      quality: 72,
      success: res => resolve(res.tempFilePath || localPath),
      fail: () => resolve(localPath)
    })
  })
}

module.exports = { compressImageForUpload }
